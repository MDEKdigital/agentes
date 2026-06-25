# Block Conversation + Delete Lead Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Bloquear" button in the inbox that silences the agent on a conversation without hiding messages, and a "Apagar" button in the leads page that deletes a contact and all their data with a clear warning.

**Architecture:** `is_blocked` flag is added to the `conversations` table via migration and checked in the worker before running the agent. The leads DELETE endpoint relies on existing FK cascade (contacts → conversations → messages). UI shows block badge and confirmation dialogs with explicit warnings.

**Tech Stack:** Supabase PostgreSQL (migration), Fastify 5.2 (API), BullMQ worker (TypeScript), Next.js 15 + React (web UI).

## Global Constraints

- All API routes use `authMiddleware` + membership check before any DB operation
- `getAdminClient()` for all DB writes in API
- Worker uses `getAdminClient()` — no RLS
- Shared types live in `packages/shared/src/types/conversation.ts`
- No new npm packages — use existing lucide-react icons, existing UI primitives
- Migrations numbered sequentially: next is `00044`

---

### Task 1: Migration — add `is_blocked` to conversations

**Files:**
- Create: `supabase/migrations/00044_add_conversation_blocked.sql`

**Interfaces:**
- Produces: `conversations.is_blocked boolean NOT NULL DEFAULT false` column available in all subsequent queries

- [ ] **Step 1: Create migration file**

```sql
-- supabase/migrations/00044_add_conversation_blocked.sql
ALTER TABLE conversations
  ADD COLUMN is_blocked boolean NOT NULL DEFAULT false;
```

- [ ] **Step 2: Apply migration to local Supabase**

Run: `npx supabase db push` (or `npx supabase migration up`) from the repo root.
Expected: migration applies without error.

- [ ] **Step 3: Verify column exists**

Run in Supabase Studio SQL editor:
```sql
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'conversations' AND column_name = 'is_blocked';
```
Expected: 1 row with `boolean` type and `false` default.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/00044_add_conversation_blocked.sql
git commit -m "feat(db): add is_blocked column to conversations"
```

---

### Task 2: Shared type — add `is_blocked` to Conversation interface

**Files:**
- Modify: `packages/shared/src/types/conversation.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `Conversation.is_blocked: boolean` used by API, worker, and web

- [ ] **Step 1: Add `is_blocked` field to Conversation interface**

In `packages/shared/src/types/conversation.ts`, after `awaiting_activation_confirmation`:

```typescript
export interface Conversation {
  id: string;
  organization_id: string;
  agent_id: string;
  evolution_instance_id: string;
  contact_id: string;
  status: ConversationStatus;
  is_human_takeover: boolean;
  human_takeover_at: string | null;
  assigned_to: string | null;
  tags: string[];
  last_message_at: string;
  is_keyword_activated: boolean;
  awaiting_activation_confirmation: boolean;
  is_blocked: boolean;
  created_at: string;
  updated_at: string;
}
```

- [ ] **Step 2: Build shared package to verify no type errors**

Run: `cd packages/shared && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/types/conversation.ts
git commit -m "feat(shared): add is_blocked to Conversation type"
```

---

### Task 3: API — PATCH /conversations/:id/block endpoint

**Files:**
- Modify: `apps/api/src/routes/conversations/index.ts`

**Interfaces:**
- Consumes: `Conversation.is_blocked` (Task 2)
- Produces: `PATCH /conversations/:conversationId/block` with body `{ blocked: boolean }` → 204

- [ ] **Step 1: Add block endpoint after the tags endpoint (around line 347)**

In `apps/api/src/routes/conversations/index.ts`, add before the existing `app.delete` route:

```typescript
  app.patch<{ Params: { conversationId: string } }>(
    "/conversations/:conversationId/block",
    async (request, reply) => {
      const { conversationId } = request.params;
      const body = request.body as Record<string, unknown> | null | undefined;

      if (typeof body?.blocked !== "boolean") {
        return reply.status(400).send({ error: "Campo 'blocked' (boolean) é obrigatório." });
      }
      const blocked = body.blocked as boolean;

      const db = getAdminClient();
      const { data: conv } = await db
        .from("conversations")
        .select("organization_id")
        .eq("id", conversationId)
        .single();

      if (!conv) return reply.status(404).send({ error: "Conversa não encontrada" });

      const membership = request.user.memberships.find(
        (m) => m.organization_id === conv.organization_id
      );
      if (!membership) return reply.status(403).send({ error: "Acesso negado" });

      const { error } = await db
        .from("conversations")
        .update({ is_blocked: blocked })
        .eq("id", conversationId)
        .eq("organization_id", conv.organization_id);

      if (error) return reply.status(500).send({ error: "Falha ao atualizar bloqueio da conversa" });

      fireAudit(db, {
        organization_id: conv.organization_id,
        user_id: request.user.id,
        action: blocked ? "conversation.blocked" : "conversation.unblocked",
        entity_type: "conversation",
        entity_id: conversationId,
      }, request.log);

      return reply.status(204).send();
    }
  );
```

- [ ] **Step 2: Build API to verify no type errors**

Run: `cd apps/api && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/routes/conversations/index.ts
git commit -m "feat(api): add PATCH /conversations/:id/block endpoint"
```

---

### Task 4: Worker — skip processing when conversation is blocked

**Files:**
- Modify: `apps/worker/src/workers/process-message.ts`

**Interfaces:**
- Consumes: `Conversation.is_blocked` (Task 2) — already fetched via `getConversationById`
- Produces: early return when `conversation.is_blocked === true`, before `runAgent` is called

- [ ] **Step 1: Add is_blocked check after the is_human_takeover check**

In `apps/worker/src/workers/process-message.ts`, after line 323 (`if (conversation.is_human_takeover)`), add:

```typescript
        if ((conversation as { is_blocked?: boolean }).is_blocked) {
          console.log(`Conversation ${conversationId} is blocked, skipping agent`);
          return;
        }
```

The full block should look like:

```typescript
        if (!agent.is_active) {
          console.log(`Agent ${agentId} is inactive, skipping`);
          return;
        }
        if (conversation.is_human_takeover) {
          console.log(`Conversation ${conversationId} is in human takeover, skipping`);
          return;
        }
        if ((conversation as { is_blocked?: boolean }).is_blocked) {
          console.log(`Conversation ${conversationId} is blocked, skipping agent`);
          return;
        }
        if ((conversation as { status?: string }).status === "resolved") {
          console.log(`Conversation ${conversationId} already resolved, skipping retry`);
          return;
        }
```

- [ ] **Step 2: Build worker to verify no type errors**

Run: `cd apps/worker && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/worker/src/workers/process-message.ts
git commit -m "feat(worker): skip agent when conversation is_blocked"
```

---

### Task 5: UI — block button in SidePanel + badge in inbox

**Files:**
- Modify: `apps/web/src/components/inbox/side-panel.tsx`

**Interfaces:**
- Consumes: `conversation.is_blocked: boolean` passed as prop
- Produces: "Bloquear" / "Desbloquear" button that calls `PATCH /conversations/:id/block`; badge shown when blocked

- [ ] **Step 1: Update SidePanelProps and add block handler**

Replace the full content of `apps/web/src/components/inbox/side-panel.tsx`:

```typescript
"use client";

import { TakeoverBar } from "./takeover-bar";
import { TagsInput } from "./tags-input";
import { NotesPanel } from "./notes-panel";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiFetch } from "@/lib/api";
import { Phone, User, Trash2, Ban, CheckCircle2 } from "lucide-react";
import type { ConversationStatus } from "@aula-agente/shared";

interface SidePanelProps {
  conversation: {
    id: string;
    organization_id: string;
    status: ConversationStatus;
    is_human_takeover: boolean;
    is_blocked: boolean;
    assigned_to: string | null;
    tags: string[];
    contacts: { phone: string; name: string | null };
  };
  onUpdate: () => void;
  onDelete: () => void;
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </p>
  );
}

export function SidePanel({ conversation, onUpdate, onDelete }: SidePanelProps) {
  const handleStatusChange = async (status: string) => {
    try {
      await apiFetch(`/conversations/${conversation.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      onUpdate();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erro ao atualizar status");
    }
  };

  const handleToggleBlock = async () => {
    const newBlocked = !conversation.is_blocked;
    try {
      await apiFetch(`/conversations/${conversation.id}/block`, {
        method: "PATCH",
        body: JSON.stringify({ blocked: newBlocked }),
      });
      onUpdate();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erro ao atualizar bloqueio");
    }
  };

  return (
    <div className="flex w-[280px] shrink-0 flex-col overflow-y-auto border-l border-border bg-card">
      {/* Contato */}
      <div className="border-b border-border p-4">
        <SectionHeader>Contato</SectionHeader>
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10">
            <User className="h-4 w-4 text-blue-electric-300" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">
              {conversation.contacts.name || "Sem nome"}
            </p>
            <div className="flex items-center gap-1 mt-0.5">
              <Phone className="h-2.5 w-2.5 text-muted-foreground" />
              <p className="font-mono text-[11px] text-muted-foreground">
                {conversation.contacts.phone}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Status */}
      <div className="border-b border-border p-4">
        <SectionHeader>Status</SectionHeader>
        {conversation.is_blocked && (
          <div className="mb-2 flex items-center gap-1.5 rounded-md bg-destructive/10 px-2 py-1">
            <Ban className="h-3 w-3 text-destructive" />
            <span className="text-[11px] font-medium text-destructive">Conversa bloqueada</span>
          </div>
        )}
        <Select value={conversation.status} onValueChange={handleStatusChange}>
          <SelectTrigger className="h-8 text-xs bg-muted border-border">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="open">Aberto</SelectItem>
            <SelectItem value="waiting">Aguardando</SelectItem>
            <SelectItem value="resolved">Resolvido</SelectItem>
            <SelectItem value="closed">Fechado</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Atendimento */}
      <div className="border-b border-border p-4">
        <SectionHeader>Atendimento</SectionHeader>
        <TakeoverBar
          conversationId={conversation.id}
          isHumanTakeover={conversation.is_human_takeover}
          assignedTo={conversation.assigned_to}
          organizationId={conversation.organization_id}
          onUpdate={onUpdate}
        />
      </div>

      {/* Tags */}
      <div className="border-b border-border p-4">
        <SectionHeader>Tags</SectionHeader>
        <TagsInput
          conversationId={conversation.id}
          tags={conversation.tags}
          onUpdate={onUpdate}
        />
      </div>

      {/* Notas */}
      <div className="border-b border-border p-4">
        <SectionHeader>Notas Internas</SectionHeader>
        <NotesPanel
          conversationId={conversation.id}
          organizationId={conversation.organization_id}
        />
      </div>

      {/* Ações */}
      <div className="mt-auto flex flex-col gap-2 p-4">
        <button
          onClick={handleToggleBlock}
          className={`flex w-full items-center justify-center gap-2 rounded-md border px-3 py-2 text-xs font-medium transition-colors ${
            conversation.is_blocked
              ? "border-amber-500/30 text-amber-500 hover:bg-amber-500/10"
              : "border-destructive/30 text-destructive hover:bg-destructive/10"
          }`}
        >
          {conversation.is_blocked ? (
            <>
              <CheckCircle2 className="h-3.5 w-3.5" />
              Desbloquear conversa
            </>
          ) : (
            <>
              <Ban className="h-3.5 w-3.5" />
              Bloquear conversa
            </>
          )}
        </button>
        <button
          onClick={onDelete}
          className="flex w-full items-center justify-center gap-2 rounded-md border border-destructive/30 px-3 py-2 text-xs font-medium text-destructive hover:bg-destructive/10 transition-colors"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Apagar conversa
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Find where SidePanel is used in the inbox page and pass `is_blocked`**

The inbox page is at `apps/web/src/app/(dashboard)/inbox/page.tsx`. Find the `<SidePanel` usage and ensure the `conversation` object passed includes `is_blocked`. The conversation data comes from the API (`/conversations/:id/full`) which already returns the full row — just make sure `is_blocked` is included in the prop shape.

Look for the conversation type in the inbox page. If it has a local interface, add `is_blocked: boolean` to it. Pass `is_blocked: selectedConv.is_blocked ?? false` to `<SidePanel>`.

- [ ] **Step 3: Build web to verify no type errors**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/inbox/side-panel.tsx
git add apps/web/src/app/(dashboard)/inbox/page.tsx
git commit -m "feat(inbox): add block/unblock conversation button in side panel"
```

---

### Task 6: API — DELETE /organizations/:orgId/contacts/:contactId

**Files:**
- Modify: `apps/api/src/routes/contacts/index.ts`

**Interfaces:**
- Produces: `DELETE /organizations/:organizationId/contacts/:contactId` → 204
- FK cascade handles: messages deleted when conversations deleted, conversations deleted when contact deleted

- [ ] **Step 1: Add DELETE endpoint to contacts route**

Replace the full content of `apps/api/src/routes/contacts/index.ts`:

```typescript
import type { FastifyInstance } from "fastify";
import { getAdminClient, getContactsByOrganization } from "@aula-agente/database";
import { authMiddleware } from "../../middleware/auth";
import { fireAudit } from "../../lib/audit";

export default async function contactRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authMiddleware);

  app.get<{ Params: { organizationId: string } }>(
    "/organizations/:organizationId/contacts",
    async (request, reply) => {
      const { organizationId } = request.params;

      const membership = request.user.memberships.find(
        (m) => m.organization_id === organizationId
      );
      if (!membership) return reply.status(403).send({ error: "Acesso negado" });

      const db = getAdminClient();
      const contacts = await getContactsByOrganization(db, organizationId);
      return reply.send({ contacts });
    }
  );

  app.delete<{ Params: { organizationId: string; contactId: string } }>(
    "/organizations/:organizationId/contacts/:contactId",
    async (request, reply) => {
      const { organizationId, contactId } = request.params;

      const membership = request.user.memberships.find(
        (m) => m.organization_id === organizationId
      );
      if (!membership) return reply.status(403).send({ error: "Acesso negado" });

      const db = getAdminClient();

      const { data: contact } = await db
        .from("contacts")
        .select("id")
        .eq("id", contactId)
        .eq("organization_id", organizationId)
        .maybeSingle();

      if (!contact) return reply.status(404).send({ error: "Lead não encontrado" });

      const { error } = await db
        .from("contacts")
        .delete()
        .eq("id", contactId)
        .eq("organization_id", organizationId);

      if (error) return reply.status(500).send({ error: "Falha ao apagar lead" });

      fireAudit(db, {
        organization_id: organizationId,
        user_id: request.user.id,
        action: "contact.deleted",
        entity_type: "contact",
        entity_id: contactId,
      }, request.log);

      return reply.status(204).send();
    }
  );
}
```

- [ ] **Step 2: Build API to verify no type errors**

Run: `cd apps/api && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/routes/contacts/index.ts
git commit -m "feat(api): add DELETE /organizations/:orgId/contacts/:contactId"
```

---

### Task 7: UI — delete lead with confirmation dialog

**Files:**
- Modify: `apps/web/src/app/(dashboard)/leads/page.tsx`

**Interfaces:**
- Consumes: `DELETE /organizations/:orgId/contacts/:contactId` (Task 6)
- Produces: trash button in each row + confirmation dialog with explicit warning + optimistic removal from list

- [ ] **Step 1: Replace leads page with delete functionality**

Replace the full content of `apps/web/src/app/(dashboard)/leads/page.tsx`:

```typescript
"use client";

import { useEffect, useState } from "react";
import { useOrganization } from "@/providers/organization-provider";
import { apiFetch } from "@/lib/api";
import { UserCircle, Phone, MessageSquare, Search, Trash2 } from "lucide-react";

interface Conversation {
  id: string;
  status: string;
  created_at: string;
  updated_at: string;
}

interface Lead {
  id: string;
  phone: string;
  name: string | null;
  photo_url: string | null;
  created_at: string;
  updated_at: string;
  conversations: Conversation[];
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatPhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 13) {
    return `+${digits.slice(0, 2)} (${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9)}`;
  }
  if (digits.length === 12) {
    return `+${digits.slice(0, 2)} (${digits.slice(2, 4)}) ${digits.slice(4, 8)}-${digits.slice(8)}`;
  }
  return phone;
}

export default function LeadsPage() {
  const { currentOrg, loading: orgLoading } = useOrganization();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<Lead | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!currentOrg) return;
    setLoading(true);
    apiFetch(`/organizations/${currentOrg.id}/contacts`)
      .then((data) => setLeads((data.contacts as Lead[]) || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [currentOrg]);

  const handleDeleteConfirm = async () => {
    if (!currentOrg || !confirmDelete) return;
    setDeleting(true);
    try {
      await apiFetch(`/organizations/${currentOrg.id}/contacts/${confirmDelete.id}`, {
        method: "DELETE",
      });
      setLeads((prev) => prev.filter((l) => l.id !== confirmDelete.id));
      setConfirmDelete(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erro ao apagar lead");
    } finally {
      setDeleting(false);
    }
  };

  const filtered = leads.filter((l) => {
    const q = search.toLowerCase();
    return (
      !q ||
      l.phone.includes(q) ||
      (l.name ?? "").toLowerCase().includes(q)
    );
  });

  if (orgLoading || loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Leads</h1>
          <p className="text-sm text-muted-foreground">
            {leads.length} {leads.length === 1 ? "contato capturado" : "contatos capturados"}
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="border-b border-border px-6 py-3">
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Buscar por nome ou telefone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-md border border-border bg-background pl-9 pr-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto px-6 py-4">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <UserCircle className="h-12 w-12 text-muted-foreground/40 mb-3" />
            <p className="text-sm font-medium text-muted-foreground">
              {search ? "Nenhum lead encontrado" : "Nenhum lead capturado ainda"}
            </p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              {!search && "Os leads aparecem aqui quando interagem pelo WhatsApp"}
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Lead
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Telefone
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Conversas
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Primeiro contato
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Última atividade
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Ações
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((lead) => {
                  const lastConv = lead.conversations
                    .slice()
                    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())[0];
                  const openConvs = lead.conversations.filter((c) => c.status !== "resolved").length;

                  return (
                    <tr key={lead.id} className="bg-card hover:bg-accent/40 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          {lead.photo_url ? (
                            <img
                              src={lead.photo_url}
                              alt={lead.name ?? lead.phone}
                              className="h-8 w-8 rounded-full object-cover"
                            />
                          ) : (
                            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-blue-electric-300">
                              {(lead.name ?? lead.phone).slice(0, 2).toUpperCase()}
                            </div>
                          )}
                          <span className="font-medium text-foreground">
                            {lead.name ?? <span className="text-muted-foreground italic">Sem nome</span>}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                          <Phone className="h-3.5 w-3.5" />
                          <span>{formatPhone(lead.phone)}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="text-foreground">{lead.conversations.length}</span>
                          {openConvs > 0 && (
                            <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-blue-electric-300">
                              {openConvs} aberta{openConvs > 1 ? "s" : ""}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {formatDate(lead.created_at)}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {lastConv ? formatDate(lastConv.updated_at) : "—"}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => setConfirmDelete(lead)}
                          className="inline-flex items-center justify-center rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                          title="Apagar lead"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Confirmation dialog */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-xl">
            <h2 className="text-base font-semibold text-foreground">Apagar lead?</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Você está prestes a excluir{" "}
              <span className="font-medium text-foreground">
                {confirmDelete.name || formatPhone(confirmDelete.phone)}
              </span>
              . Isso vai apagar permanentemente o contato,{" "}
              <span className="font-medium text-foreground">
                {confirmDelete.conversations.length}{" "}
                {confirmDelete.conversations.length === 1 ? "conversa" : "conversas"}
              </span>{" "}
              e todas as mensagens associadas.
            </p>
            <p className="mt-2 text-xs font-medium text-destructive">
              Esta ação não pode ser desfeita.
            </p>
            <div className="mt-5 flex gap-3">
              <button
                onClick={() => setConfirmDelete(null)}
                disabled={deleting}
                className="flex-1 rounded-md border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-accent disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleDeleteConfirm}
                disabled={deleting}
                className="flex-1 rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
              >
                {deleting ? "Apagando..." : "Sim, excluir tudo"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Build web to verify no type errors**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add "apps/web/src/app/(dashboard)/leads/page.tsx"
git commit -m "feat(leads): add delete lead with cascade warning dialog"
```

---

### Task 8: Wire `is_blocked` in inbox page and final push

**Files:**
- Modify: `apps/web/src/app/(dashboard)/inbox/page.tsx`

**Interfaces:**
- Consumes: `SidePanel.conversation.is_blocked` (Task 5)
- Produces: full feature working end-to-end; final commit + push

- [ ] **Step 1: Read inbox page to find the conversation type**

Read `apps/web/src/app/(dashboard)/inbox/page.tsx` and find the local conversation interface or the object passed to `<SidePanel>`.

- [ ] **Step 2: Add `is_blocked` to the local conversation interface**

Find the interface/type that describes the selected conversation and add:
```typescript
is_blocked: boolean;
```

- [ ] **Step 3: Pass `is_blocked` from fetched data to SidePanel**

Where the conversation object is built or passed to `<SidePanel conversation={...}>`, ensure `is_blocked` is included:
```typescript
is_blocked: selectedConversation.is_blocked ?? false,
```

- [ ] **Step 4: Full build check**

Run from repo root: `npx turbo build --filter=web --filter=api --filter=worker`
Expected: all three packages build without errors.

- [ ] **Step 5: Commit and push**

```bash
git add "apps/web/src/app/(dashboard)/inbox/page.tsx"
git commit -m "feat(inbox): pass is_blocked to SidePanel from conversation data"
git push origin main
```
