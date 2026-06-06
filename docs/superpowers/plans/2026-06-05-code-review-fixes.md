# Code Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir os 10 bugs identificados no code review das fases 5-8 do dashboard.

**Architecture:** As correções tocam frontend (`apps/web/src`), banco de dados (`supabase/migrations`) e backend (`apps/api/src`). Cada task é independente e pode ser commitada separadamente. As tasks 7 e 8 adicionam rotas ao Fastify API para mover operações sensíveis para fora do cliente.

**Tech Stack:** Next.js 14, Supabase (client + RLS), Fastify, TypeScript, React Hook Form

---

## Arquivo Map

| Task | Modifica |
|---|---|
| 1 | `supabase/migrations/00010_members_update_rls.sql` (novo) |
| 2 | `apps/web/src/app/(dashboard)/inbox/page.tsx` |
| 3 | `apps/web/src/app/(dashboard)/team/page.tsx`, `apps/web/src/components/inbox/notes-panel.tsx` |
| 4 | `apps/web/src/app/(dashboard)/agents/[agentId]/page.tsx` |
| 5 | `apps/web/src/components/agents/document-upload.tsx` |
| 6 | `apps/web/src/app/(dashboard)/instances/page.tsx` |
| 7 | `apps/api/src/routes/secrets/index.ts` (novo), `apps/api/src/server.ts`, `apps/web/src/app/(dashboard)/settings/page.tsx` |
| 8 | `apps/api/src/routes/conversations/index.ts` (novo), `apps/api/src/server.ts`, `apps/web/src/components/inbox/side-panel.tsx` |

---

### Task 1: Migração — UPDATE RLS em organization_members

**Contexto:** A tabela `organization_members` tem RLS habilitado mas **nenhuma** UPDATE policy. Com RLS ativo e sem UPDATE policy, o Postgres retorna sucesso mas afeta 0 rows — mudanças de role pelo admin são silenciosamente ignoradas em produção.

**Files:**
- Create: `supabase/migrations/00010_members_update_rls.sql`

- [ ] **Step 1: Criar o arquivo de migração**

```sql
-- supabase/migrations/00010_members_update_rls.sql
-- Adiciona UPDATE policy em organization_members.
-- Sem esta policy (RLS habilitado + sem UPDATE policy = default deny),
-- o Postgres descartava silenciosamente as mudanças de role.
CREATE POLICY "org_members_update" ON organization_members
  FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  );
```

- [ ] **Step 2: Aplicar a migração localmente**

```bash
npx supabase db push
# ou se usar supabase CLI direto:
# supabase migration up
```

Esperado: `Applying migration 00010_members_update_rls.sql... done`

- [ ] **Step 3: Verificar que a policy foi criada**

```bash
npx supabase db diff
```

Esperado: sem diff (migração aplicada).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/00010_members_update_rls.sql
git commit -m "fix: add UPDATE RLS policy for organization_members role changes"
```

---

### Task 2: inbox/page.tsx — 3 bugs (spinner travado, erros silenciados, channel churn)

**Contexto:**
- Bug A: `fetchConversations` retorna cedo sem `setLoading(false)` quando `currentOrg` é null → spinner eterno.
- Bug B: `const { data } = await query` ignora o campo `error` → inbox vazia sem feedback em falhas.
- Bug C: `onInsert: () => fetchConversations()` cria nova função a cada render → `useRealtime` recria o canal Supabase a cada mudança de `statusFilter`.

**Files:**
- Modify: `apps/web/src/app/(dashboard)/inbox/page.tsx`

- [ ] **Step 1: Aplicar todas as correções no arquivo**

Substituir o conteúdo completo de `apps/web/src/app/(dashboard)/inbox/page.tsx`:

```tsx
"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useOrganization } from "@/providers/organization-provider";
import { createClient } from "@/lib/supabase/client";
import { useRealtime } from "@/lib/realtime";
import { ConversationList } from "@/components/inbox/conversation-list";
import { ChatPanel } from "@/components/inbox/chat-panel";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";

interface ConversationRow {
  id: string;
  status: string;
  is_human_takeover: boolean;
  last_message_at: string;
  tags: string[];
  assigned_to: string | null;
  contacts: { phone: string; name: string | null };
  agents: { name: string };
}

export default function InboxPage() {
  const { currentOrg } = useOrganization();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  const selectedId = searchParams.get("id");

  const fetchConversations = useCallback(async () => {
    if (!currentOrg) {
      setLoading(false); // Bug A fix: não travar spinner se org nunca carregar
      return;
    }
    const supabase = createClient();

    let query = supabase
      .from("conversations")
      .select("*, contacts(phone, name), agents(name)")
      .eq("organization_id", currentOrg.id)
      .order("last_message_at", { ascending: false });

    if (statusFilter !== "all") {
      query = query.eq("status", statusFilter);
    }

    const { data, error: queryError } = await query; // Bug B fix: captura erro
    if (queryError) {
      setError("Erro ao carregar conversas. Tente novamente.");
      setLoading(false);
      return;
    }
    setError(null);
    setConversations((data as ConversationRow[]) || []);
    setLoading(false);
  }, [currentOrg, statusFilter]);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  // Bug C fix: passa fetchConversations diretamente (já é useCallback estável)
  // em vez de inline arrows (() => fetchConversations()) que mudam a cada render
  useRealtime({
    table: "conversations",
    filter: currentOrg ? `organization_id=eq.${currentOrg.id}` : undefined,
    onInsert: fetchConversations,
    onUpdate: fetchConversations,
    enabled: !!currentOrg,
  });

  const handleSelect = (id: string) => {
    router.push(`/inbox?id=${id}`);
  };

  const filtered = search
    ? conversations.filter((c) => {
        const lower = search.toLowerCase();
        return (
          c.contacts?.name?.toLowerCase().includes(lower) ||
          c.contacts?.phone?.includes(search)
        );
      })
    : conversations;

  if (loading) return <div className="p-6">Carregando...</div>;

  if (error) {
    return (
      <div className="p-6 text-destructive">{error}</div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] -m-6">
      <div className="flex w-80 flex-col border-r">
        <div className="space-y-2 border-b p-3">
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger>
              <SelectValue placeholder="Filtrar status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="open">Abertos</SelectItem>
              <SelectItem value="waiting">Aguardando</SelectItem>
              <SelectItem value="resolved">Resolvidos</SelectItem>
              <SelectItem value="closed">Fechados</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex-1 overflow-y-auto">
          <ConversationList
            conversations={filtered}
            selectedId={selectedId}
            onSelect={handleSelect}
          />
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {selectedId ? (
          <ChatPanel conversationId={selectedId} />
        ) : (
          <div className="flex flex-1 items-center justify-center text-muted-foreground">
            <p>Selecione uma conversa</p>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verificar types**

```bash
cd apps/web && npx tsc --noEmit
```

Esperado: sem erros.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/\(dashboard\)/inbox/page.tsx
git commit -m "fix: inbox stuck spinner, silent errors, and realtime channel churn"
```

---

### Task 3: team/page.tsx + notes-panel.tsx — null user guard

**Contexto:**
- `team/page.tsx` line 40: `user!.id` lança TypeError se `getUser()` retornar `{user: null}` (sessão expirada mid-session).
- `team/page.tsx` line 34: `if (!currentOrg) return` sem `setLoading(false)` → spinner travado.
- `notes-panel.tsx` line 46: mesmo padrão de `user!.id` + `fetchNotes()` sem await.

**Files:**
- Modify: `apps/web/src/app/(dashboard)/team/page.tsx`
- Modify: `apps/web/src/components/inbox/notes-panel.tsx`

- [ ] **Step 1: Corrigir team/page.tsx**

```tsx
"use client";

import { useEffect, useState, useCallback } from "react";
import { useOrganization } from "@/providers/organization-provider";
import { createClient } from "@/lib/supabase/client";
import { MembersList } from "@/components/team/members-list";
import { InviteDialog } from "@/components/team/invite-dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface Member {
  id: string;
  user_id: string;
  role: string;
  created_at: string;
}

interface Invitation {
  id: string;
  email: string;
  role: string;
  expires_at: string;
}

export default function TeamPage() {
  const { currentOrg } = useOrganization();
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string>("");
  const [currentUserRole, setCurrentUserRole] = useState<string>("");
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    if (!currentOrg) {
      setLoading(false); // fix: não travar spinner se org não carregar
      return;
    }
    const supabase = createClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return; // fix: guard contra sessão expirada

    setCurrentUserId(user.id);

    const [membersResult, invitationsResult] = await Promise.all([
      supabase
        .from("organization_members")
        .select("*")
        .eq("organization_id", currentOrg.id)
        .order("created_at"),
      supabase
        .from("organization_invitations")
        .select("*")
        .eq("organization_id", currentOrg.id)
        .eq("status", "pending")
        .order("created_at", { ascending: false }),
    ]);

    const membersList = (membersResult.data || []) as Member[];
    setMembers(membersList);
    setInvitations((invitationsResult.data || []) as Invitation[]);

    const myMembership = membersList.find((m) => m.user_id === user.id);
    setCurrentUserRole(myMembership?.role || "agent");

    setLoading(false);
  }, [currentOrg]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) return <div>Carregando...</div>;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Equipe</h1>
        {(currentUserRole === "owner" || currentUserRole === "admin") && (
          <InviteDialog onInvited={fetchData} />
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Membros ({members.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <MembersList
            members={members}
            currentUserId={currentUserId}
            currentUserRole={currentUserRole}
            onRefresh={fetchData}
          />
        </CardContent>
      </Card>

      {invitations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Convites Pendentes ({invitations.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {invitations.map((inv) => (
                <div
                  key={inv.id}
                  className="flex items-center justify-between rounded-md border p-3"
                >
                  <div>
                    <p className="text-sm">{inv.email}</p>
                    <p className="text-xs text-muted-foreground">
                      Expira em {new Date(inv.expires_at).toLocaleDateString("pt-BR")}
                    </p>
                  </div>
                  <Badge variant="secondary">{inv.role}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Corrigir notes-panel.tsx**

Três problemas: (a) `user!.id` sem guard, (b) `fetchNotes()` sem await no final, (c) insert sem tratar erro.

```tsx
"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Plus } from "lucide-react";
import type { ConversationNote } from "@aula-agente/shared";

interface NotesPanelProps {
  conversationId: string;
  organizationId: string;
}

export function NotesPanel({ conversationId, organizationId }: NotesPanelProps) {
  const [notes, setNotes] = useState<ConversationNote[]>([]);
  const [newNote, setNewNote] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchNotes = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("conversation_notes")
      .select("*")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false });
    setNotes((data as ConversationNote[]) || []);
  }, [conversationId]);

  useEffect(() => {
    fetchNotes();
  }, [fetchNotes]);

  const handleAdd = async () => {
    if (!newNote.trim()) return;
    setSaving(true);
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return; // fix: guard contra sessão expirada

      const { error } = await supabase.from("conversation_notes").insert({
        conversation_id: conversationId,
        organization_id: organizationId,
        user_id: user.id,
        content: newNote.trim(),
      });

      if (error) throw error;

      setNewNote("");
      await fetchNotes(); // fix: await para garantir refresh antes de desbloquear UI
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erro ao salvar nota");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Textarea
          value={newNote}
          onChange={(e) => setNewNote(e.target.value)}
          placeholder="Nota interna..."
          rows={2}
          className="text-xs"
        />
        <Button size="icon" onClick={handleAdd} disabled={saving || !newNote.trim()}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      <div className="space-y-2">
        {notes.map((note) => (
          <div
            key={note.id}
            className="rounded-md bg-yellow-50 p-2 text-xs dark:bg-yellow-900/20"
          >
            <p>{note.content}</p>
            <p className="mt-1 text-muted-foreground">
              {new Date(note.created_at).toLocaleString("pt-BR")}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verificar types**

```bash
cd apps/web && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/\(dashboard\)/team/page.tsx apps/web/src/components/inbox/notes-panel.tsx
git commit -m "fix: null user guard and stuck loading in team page and notes panel"
```

---

### Task 4: agents/[agentId]/page.tsx — handleDelete sem tratamento de erro

**Contexto:** `handleDelete` chama `supabase.delete()` sem verificar o campo `error` e faz `router.push("/agents")` incondicionalmente. Se o delete falhar (RLS, FK constraint), o usuário é redirecionado como se tivesse funcionado.

**Files:**
- Modify: `apps/web/src/app/(dashboard)/agents/[agentId]/page.tsx`

- [ ] **Step 1: Corrigir handleDelete para checar erro**

Substituir apenas a função `handleDelete` (linhas 35-40):

```tsx
  const handleDelete = async () => {
    if (!confirm("Tem certeza que deseja excluir este agente?")) return;
    const supabase = createClient();
    const { error } = await supabase.from("agents").delete().eq("id", agentId);
    if (error) {
      alert(error.message);
      return;
    }
    router.push("/agents");
  };
```

- [ ] **Step 2: Verificar types**

```bash
cd apps/web && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/\(dashboard\)/agents/\[agentId\]/page.tsx
git commit -m "fix: check delete error before navigating in agent edit page"
```

---

### Task 5: document-upload.tsx — handleDelete sem verificar response.ok

**Contexto:** `handleDelete` usa `fetch` bruto sem verificar `response.ok`, chama `onRefresh()` mesmo em falha HTTP. A correção converte o delete para `apiFetch` (que verifica `response.ok` internamente) e converte o import dinâmico desnecessário para estático.

**Files:**
- Modify: `apps/web/src/components/agents/document-upload.tsx`

- [ ] **Step 1: Reescrever o arquivo com as correções**

```tsx
"use client";

import { useState, useRef } from "react";
import { useOrganization } from "@/providers/organization-provider";
import { createClient } from "@/lib/supabase/client"; // fix: static import
import { apiFetch } from "@/lib/api"; // fix: usar apiFetch para delete
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Upload, Trash2, FileText, Loader2 } from "lucide-react";
import type { KnowledgeDocument } from "@aula-agente/shared";

interface DocumentUploadProps {
  agentId: string;
  documents: KnowledgeDocument[];
  onRefresh: () => void;
}

const statusColors: Record<string, "default" | "secondary" | "destructive"> = {
  ready: "default",
  processing: "secondary",
  error: "destructive",
};

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export function DocumentUpload({ agentId, documents, onRefresh }: DocumentUploadProps) {
  const { currentOrg } = useOrganization();
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !currentOrg) return;

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("title", file.name);

      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();

      const response = await fetch(
        `${API_URL}/organizations/${currentOrg.id}/agents/${agentId}/documents`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${session?.access_token}` },
          body: formData,
        }
      );

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Upload failed");
      }

      onRefresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erro no upload");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDelete = async (docId: string) => {
    if (!confirm("Excluir documento?")) return;
    try {
      // fix: apiFetch verifica response.ok e lança em caso de erro HTTP
      await apiFetch(`/documents/${docId}`, { method: "DELETE" });
      onRefresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erro ao excluir documento");
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Documentos</CardTitle>
        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.txt,.md,.docx,.csv"
            onChange={handleUpload}
            className="hidden"
          />
          <Button onClick={() => fileInputRef.current?.click()} disabled={uploading} size="sm">
            {uploading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Upload className="mr-2 h-4 w-4" />
            )}
            Upload
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {documents.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum documento enviado</p>
        ) : (
          <div className="space-y-2">
            {documents.map((doc) => (
              <div
                key={doc.id}
                className="flex items-center justify-between rounded-md border p-3"
              >
                <div className="flex items-center gap-3">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">{doc.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {doc.file_type.toUpperCase()} - {doc.chunk_count} chunks
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={statusColors[doc.status] ?? "secondary"}>{doc.status}</Badge>
                  <Button variant="ghost" size="icon" onClick={() => handleDelete(doc.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Verificar types**

```bash
cd apps/web && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/agents/document-upload.tsx
git commit -m "fix: document delete now checks response.ok via apiFetch"
```

---

### Task 6: instances/page.tsx — fetchInstances sem try/catch

**Contexto:** `fetchInstances` chama `apiFetch` sem try/catch. Se a chamada lançar (erro de rede, 401, 500), `setLoading(false)` nunca é chamado e o spinner trava permanentemente.

**Files:**
- Modify: `apps/web/src/app/(dashboard)/instances/page.tsx`

- [ ] **Step 1: Adicionar try/catch/finally em fetchInstances**

Substituir apenas a função `fetchInstances` (linhas 34-39):

```tsx
  const fetchInstances = useCallback(async () => {
    if (!currentOrg) return;
    try {
      const data = await apiFetch(`/organizations/${currentOrg.id}/instances`);
      setInstances(data || []);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erro ao carregar instâncias");
    } finally {
      setLoading(false);
    }
  }, [currentOrg]);
```

- [ ] **Step 2: Verificar types**

```bash
cd apps/web && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/\(dashboard\)/instances/page.tsx
git commit -m "fix: fetchInstances try/catch prevents permanent spinner on API error"
```

---

### Task 7: API + frontend — secrets via backend em vez de Supabase direto

**Contexto:** `settings/page.tsx` salva API keys diretamente no Supabase. A coluna chama `encrypted_key` mas armazena plaintext. A solução correta é rotear pelo backend, que é o ponto único para adicionar criptografia futuramente. Adicionamos rotas Fastify para GET e PUT/DELETE de secrets.

**Files:**
- Create: `apps/api/src/routes/secrets/index.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/web/src/app/(dashboard)/settings/page.tsx`

- [ ] **Step 1: Criar a rota de secrets no Fastify**

```typescript
// apps/api/src/routes/secrets/index.ts
import type { FastifyInstance } from "fastify";
import { getAdminClient } from "@aula-agente/database";
import { authMiddleware } from "../../middleware/auth";

export default async function secretsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authMiddleware);

  // GET /organizations/:orgId/secrets — retorna providers configurados (sem expor a key)
  app.get<{ Params: { organizationId: string } }>(
    "/organizations/:organizationId/secrets",
    async (request, reply) => {
      const { organizationId } = request.params;
      const membership = request.user.memberships.find(
        (m) => m.organization_id === organizationId
      );
      if (!membership || !["owner", "admin"].includes(membership.role)) {
        return reply.status(403).send({ error: "Access denied" });
      }

      const db = getAdminClient();
      const { data } = await db
        .from("organization_secrets")
        .select("provider, encrypted_key")
        .eq("organization_id", organizationId);

      return data || [];
    }
  );

  // PUT /organizations/:orgId/secrets/:provider — salva ou atualiza key
  app.put<{
    Params: { organizationId: string; provider: string };
    Body: { key: string };
  }>(
    "/organizations/:organizationId/secrets/:provider",
    async (request, reply) => {
      const { organizationId, provider } = request.params;
      const { key } = request.body;

      const membership = request.user.memberships.find(
        (m) => m.organization_id === organizationId
      );
      if (!membership || !["owner", "admin"].includes(membership.role)) {
        return reply.status(403).send({ error: "Access denied" });
      }

      const db = getAdminClient();
      const { error } = await db.from("organization_secrets").upsert(
        { organization_id: organizationId, provider, encrypted_key: key },
        { onConflict: "organization_id,provider" }
      );

      if (error) return reply.status(500).send({ error: error.message });
      return reply.status(204).send();
    }
  );

  // DELETE /organizations/:orgId/secrets/:provider — remove key
  app.delete<{ Params: { organizationId: string; provider: string } }>(
    "/organizations/:organizationId/secrets/:provider",
    async (request, reply) => {
      const { organizationId, provider } = request.params;

      const membership = request.user.memberships.find(
        (m) => m.organization_id === organizationId
      );
      if (!membership || !["owner", "admin"].includes(membership.role)) {
        return reply.status(403).send({ error: "Access denied" });
      }

      const db = getAdminClient();
      await db
        .from("organization_secrets")
        .delete()
        .eq("organization_id", organizationId)
        .eq("provider", provider);

      return reply.status(204).send();
    }
  );
}
```

- [ ] **Step 2: Registrar a rota no server.ts**

Adicionar import e register em `apps/api/src/server.ts`:

```typescript
import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import evolutionWebhookRoutes from "./routes/webhooks/evolution";
import messageSendRoutes from "./routes/messages/send";
import instanceRoutes from "./routes/instances/index";
import knowledgeDocumentRoutes from "./routes/knowledge/documents";
import knowledgeFaqRoutes from "./routes/knowledge/faqs";
import secretsRoutes from "./routes/secrets/index"; // ← novo

const server = Fastify({ logger: true });

server.register(cors, { origin: true });

server.get("/health", async () => {
  return { status: "ok", timestamp: new Date().toISOString() };
});

server.register(evolutionWebhookRoutes);
server.register(messageSendRoutes);
server.register(instanceRoutes);
server.register(knowledgeDocumentRoutes);
server.register(knowledgeFaqRoutes);
server.register(secretsRoutes); // ← novo

const start = async () => {
  const port = parseInt(process.env.API_PORT || "3001", 10);
  await server.listen({ port, host: "0.0.0.0" });
  server.log.info(`API server running on port ${port}`);
};

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 3: Atualizar settings/page.tsx para usar apiFetch**

```tsx
"use client";

import { useEffect, useState, useCallback } from "react";
import { useOrganization } from "@/providers/organization-provider";
import { apiFetch } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Eye, EyeOff, Save } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { LLMProvider } from "@aula-agente/shared";

const PROVIDERS: { id: LLMProvider; name: string; placeholder: string }[] = [
  { id: "openai", name: "OpenAI", placeholder: "sk-..." },
  { id: "anthropic", name: "Anthropic", placeholder: "sk-ant-..." },
  { id: "google", name: "Google AI", placeholder: "AI..." },
];

export default function SettingsPage() {
  const { currentOrg, refetch } = useOrganization();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const fetchApiKeys = useCallback(async () => {
    if (!currentOrg) return;
    const data: { provider: string; encrypted_key: string }[] = await apiFetch(
      `/organizations/${currentOrg.id}/secrets`
    );
    const keys: Record<string, string> = {};
    (data || []).forEach((s) => {
      keys[s.provider] = s.encrypted_key;
    });
    setApiKeys(keys);
  }, [currentOrg]);

  useEffect(() => {
    if (!currentOrg) return;
    setName(currentOrg.name);
    fetchApiKeys();
  }, [currentOrg, fetchApiKeys]);

  const handleSaveName = async () => {
    if (!currentOrg || !name) return;
    setSaving(true);
    const supabase = createClient();
    await supabase.from("organizations").update({ name }).eq("id", currentOrg.id);
    await refetch();
    setSaving(false);
  };

  const handleSaveApiKey = async (provider: LLMProvider) => {
    if (!currentOrg) return;
    setSavingKey(provider);
    try {
      const key = apiKeys[provider];
      if (!key) {
        await apiFetch(`/organizations/${currentOrg.id}/secrets/${provider}`, {
          method: "DELETE",
        });
      } else {
        await apiFetch(`/organizations/${currentOrg.id}/secrets/${provider}`, {
          method: "PUT",
          body: JSON.stringify({ key }),
        });
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erro ao salvar chave");
    } finally {
      setSavingKey(null);
    }
  };

  if (!currentOrg) return <div>Carregando...</div>;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold">Configuracoes</h1>

      <Card>
        <CardHeader>
          <CardTitle>Organizacao</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Nome</Label>
            <div className="flex gap-2">
              <Input value={name} onChange={(e) => setName(e.target.value)} />
              <Button onClick={handleSaveName} disabled={saving}>
                <Save className="mr-2 h-4 w-4" />
                {saving ? "Salvando..." : "Salvar"}
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Slug</Label>
            <Input value={currentOrg.slug} disabled />
          </div>
          <div className="space-y-2">
            <Label>Plano</Label>
            <div>
              <Badge>{currentOrg.plan}</Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>API Keys dos Providers</CardTitle>
          <CardDescription>
            Configure as chaves de API para cada provider de LLM. Se nao configurado, sera
            usado o fallback global da plataforma.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {PROVIDERS.map((provider) => (
            <div key={provider.id} className="space-y-2">
              <Label>{provider.name}</Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    type={showKeys[provider.id] ? "text" : "password"}
                    value={apiKeys[provider.id] || ""}
                    onChange={(e) =>
                      setApiKeys((prev) => ({ ...prev, [provider.id]: e.target.value }))
                    }
                    placeholder={provider.placeholder}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setShowKeys((prev) => ({
                        ...prev,
                        [provider.id]: !prev[provider.id],
                      }))
                    }
                    className="absolute right-2 top-2.5 text-muted-foreground"
                  >
                    {showKeys[provider.id] ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
                <Button
                  variant="outline"
                  onClick={() => handleSaveApiKey(provider.id)}
                  disabled={savingKey === provider.id}
                >
                  {savingKey === provider.id ? "Salvando..." : "Salvar"}
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 4: Verificar types**

```bash
cd apps/api && npx tsc --noEmit
cd apps/web && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/secrets/index.ts apps/api/src/server.ts apps/web/src/app/\(dashboard\)/settings/page.tsx
git commit -m "fix: route secrets management through API backend instead of direct Supabase"
```

---

### Task 8: API + frontend — status de conversa via backend

**Contexto:** `side-panel.tsx` altera o status diretamente no Supabase, bypassando o backend. Isso impede audit trail e webhooks. Adicionamos uma rota PATCH no backend e atualizamos o componente.

**Files:**
- Create: `apps/api/src/routes/conversations/index.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/web/src/components/inbox/side-panel.tsx`

- [ ] **Step 1: Criar rota de conversas no Fastify**

```typescript
// apps/api/src/routes/conversations/index.ts
import type { FastifyInstance } from "fastify";
import { getAdminClient } from "@aula-agente/database";
import { authMiddleware } from "../../middleware/auth";

export default async function conversationRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authMiddleware);

  // PATCH /conversations/:conversationId/status
  app.patch<{
    Params: { conversationId: string };
    Body: { status: "open" | "waiting" | "resolved" | "closed" };
  }>(
    "/conversations/:conversationId/status",
    async (request, reply) => {
      const { conversationId } = request.params;
      const { status } = request.body;

      const db = getAdminClient();

      // Verificar que a conversa pertence a uma org do usuário
      const { data: conv } = await db
        .from("conversations")
        .select("organization_id")
        .eq("id", conversationId)
        .single();

      if (!conv) return reply.status(404).send({ error: "Conversation not found" });

      const membership = request.user.memberships.find(
        (m) => m.organization_id === conv.organization_id
      );
      if (!membership) return reply.status(403).send({ error: "Access denied" });

      const { error } = await db
        .from("conversations")
        .update({ status })
        .eq("id", conversationId);

      if (error) return reply.status(500).send({ error: error.message });
      return reply.status(204).send();
    }
  );
}
```

- [ ] **Step 2: Registrar rota em server.ts**

Adicionar ao `apps/api/src/server.ts` (mantendo tudo existente, apenas acrescentando):

```typescript
import conversationRoutes from "./routes/conversations/index"; // ← novo
// ...
server.register(conversationRoutes); // ← novo (após os outros registers)
```

- [ ] **Step 3: Atualizar side-panel.tsx para usar apiFetch**

```tsx
"use client";

import { TakeoverBar } from "./takeover-bar";
import { TagsInput } from "./tags-input";
import { NotesPanel } from "./notes-panel";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiFetch } from "@/lib/api";
import type { ConversationStatus } from "@aula-agente/shared";

interface SidePanelProps {
  conversation: {
    id: string;
    organization_id: string;
    status: ConversationStatus;
    is_human_takeover: boolean;
    assigned_to: string | null;
    tags: string[];
    contacts: { phone: string; name: string | null };
  };
  onUpdate: () => void;
}

export function SidePanel({ conversation, onUpdate }: SidePanelProps) {
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

  return (
    <div className="w-72 space-y-4 overflow-y-auto border-l p-4">
      <div>
        <h3 className="text-sm font-semibold">Contato</h3>
        <p className="text-sm">{conversation.contacts.name || "Sem nome"}</p>
        <p className="text-xs text-muted-foreground">{conversation.contacts.phone}</p>
      </div>

      <Separator />

      <div>
        <h3 className="mb-2 text-sm font-semibold">Status</h3>
        <Select value={conversation.status} onValueChange={handleStatusChange}>
          <SelectTrigger>
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

      <Separator />

      <div>
        <h3 className="mb-2 text-sm font-semibold">Atendimento</h3>
        <TakeoverBar
          conversationId={conversation.id}
          isHumanTakeover={conversation.is_human_takeover}
          assignedTo={conversation.assigned_to}
          organizationId={conversation.organization_id}
          onUpdate={onUpdate}
        />
      </div>

      <Separator />

      <div>
        <h3 className="mb-2 text-sm font-semibold">Tags</h3>
        <TagsInput
          conversationId={conversation.id}
          tags={conversation.tags}
          onUpdate={onUpdate}
        />
      </div>

      <Separator />

      <div>
        <h3 className="mb-2 text-sm font-semibold">Notas Internas</h3>
        <NotesPanel
          conversationId={conversation.id}
          organizationId={conversation.organization_id}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verificar types**

```bash
cd apps/api && npx tsc --noEmit
cd apps/web && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/conversations/index.ts apps/api/src/server.ts apps/web/src/components/inbox/side-panel.tsx
git commit -m "fix: route conversation status updates through API backend"
```

---

## Checklist de Revisão Final

Após todas as tasks, verificar:

- [ ] `cd apps/web && npx tsc --noEmit` — zero erros
- [ ] `cd apps/api && npx tsc --noEmit` — zero erros
- [ ] Migration aplicada (Task 1): role change funciona no UI de Team
- [ ] Inbox não trava mais em spinner quando org não carrega (Task 2)
- [ ] Inbox mostra mensagem de erro quando Supabase falha (Task 2)
- [ ] Realtime não recria canal a cada mudança de filtro de status (Task 2)
- [ ] Team page não crasha com sessão expirada (Task 3)
- [ ] Delete de agente mostra erro em vez de navegar silenciosamente (Task 4)
- [ ] Delete de documento mostra erro em caso de falha HTTP (Task 5)
- [ ] Instâncias não travam em spinner após erro de API (Task 6)
- [ ] Settings salva keys via API (Task 7) — verificar no Network tab do browser
- [ ] Status de conversa muda via API (Task 8) — verificar no Network tab
