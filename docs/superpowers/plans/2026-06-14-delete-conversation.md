# Delete Conversation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar botão de deletar conversa no inbox (lista + side panel), com navegação automática para próxima conversa após deleção.

**Architecture:** Rota `DELETE /conversations/:id` na API com verificação de membership; frontend orquestra a deleção em `inbox/page.tsx`, passa callbacks para `ConversationList` e `SidePanel`.

**Tech Stack:** TypeScript, Fastify (API), Next.js 14, Supabase (PostgreSQL), React

---

## Visão geral dos arquivos

| Arquivo | Mudança |
|---------|---------|
| `apps/api/src/routes/conversations/index.ts` | Adicionar `DELETE /:conversationId` |
| `apps/web/src/components/inbox/conversation-list.tsx` | Adicionar hover trash button + prop `onDelete` |
| `apps/web/src/components/inbox/side-panel.tsx` | Adicionar botão de deletar no rodapé + prop `onDelete` |
| `apps/web/src/app/(dashboard)/inbox/page.tsx` | Adicionar `handleDelete`, passar props |

---

## Task 1: API — `DELETE /conversations/:conversationId`

**Files:**
- Modify: `apps/api/src/routes/conversations/index.ts`

- [ ] **Step 1: Adicionar a rota DELETE**

Abrir `apps/api/src/routes/conversations/index.ts` e adicionar após o bloco `app.patch(...)`:

```typescript
  app.delete<{ Params: { conversationId: string } }>(
    "/conversations/:conversationId",
    async (request, reply) => {
      const { conversationId } = request.params;
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
        .delete()
        .eq("id", conversationId)
        .eq("organization_id", conv.organization_id);

      if (error) return reply.status(500).send({ error: "Falha ao deletar conversa" });
      return reply.status(204).send();
    }
  );
```

- [ ] **Step 2: Verificar que o arquivo compila**

```bash
cd apps/api && npx tsc --noEmit 2>&1 | head -20
```

Esperado: sem erros.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/routes/conversations/index.ts
git commit -m "feat: adicionar DELETE /conversations/:id na API"
```

---

## Task 2: `ConversationList` — botão de lixeira no hover

**Files:**
- Modify: `apps/web/src/components/inbox/conversation-list.tsx`

- [ ] **Step 1: Adicionar prop `onDelete` e botão de lixeira**

Substituir o conteúdo completo de `apps/web/src/components/inbox/conversation-list.tsx`:

```typescript
"use client";

import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { User, Trash2 } from "lucide-react";

interface ConversationItem {
  id: string;
  status: string;
  is_human_takeover: boolean;
  last_message_at: string;
  tags: string[];
  assigned_to: string | null;
  contacts: { phone: string; name: string | null };
  agents: { name: string };
}

interface ConversationListProps {
  conversations: ConversationItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}

const statusDot: Record<string, string> = {
  open: "bg-green-500",
  waiting: "bg-amber-fire-500",
  resolved: "bg-blue-electric-400",
  closed: "bg-muted-foreground",
};

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ConversationList({ conversations, selectedId, onSelect, onDelete }: ConversationListProps) {
  if (conversations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
        <p className="text-xs text-muted-foreground">Nenhuma conversa encontrada</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col py-1">
      {conversations.map((conv) => {
        const isActive = selectedId === conv.id;
        const displayName = conv.contacts.name || conv.contacts.phone;
        const initial = displayName?.[0]?.toUpperCase() || "?";

        return (
          <div key={conv.id} className="group relative">
            <button
              onClick={() => onSelect(conv.id)}
              className={cn(
                "relative flex w-full items-center gap-3 px-3 py-3 text-left transition-all",
                isActive
                  ? "border-l-[3px] border-blue-electric-400 bg-blue-electric-500/10 pl-[9px]"
                  : "border-l-[3px] border-transparent hover:bg-elevated"
              )}
            >
              {/* Avatar */}
              <Avatar className="h-9 w-9 shrink-0">
                <AvatarFallback className="bg-primary/10 text-blue-electric-300 text-xs font-semibold">
                  {conv.contacts.name ? initial : <User className="h-3.5 w-3.5" />}
                </AvatarFallback>
              </Avatar>

              {/* Info */}
              <div className="min-w-0 flex-1 pr-6">
                <div className="flex items-center justify-between gap-1">
                  <p className={cn(
                    "truncate text-xs font-medium",
                    isActive ? "text-blue-electric-300" : "text-foreground"
                  )}>
                    {displayName}
                  </p>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {formatTime(conv.last_message_at)}
                  </span>
                </div>

                <div className="mt-0.5 flex items-center gap-1.5">
                  <span className={cn(
                    "h-1.5 w-1.5 shrink-0 rounded-full",
                    statusDot[conv.status] ?? "bg-muted-foreground"
                  )} />
                  <span className="truncate text-[11px] text-muted-foreground">
                    {conv.agents?.name}
                  </span>
                  {conv.is_human_takeover && (
                    <span className="shrink-0 rounded px-1 py-px text-[10px] font-medium bg-blue-electric-500/10 text-blue-electric-300 border border-blue-electric-500/20">
                      Humano
                    </span>
                  )}
                </div>
              </div>
            </button>

            {/* Botão de deletar — visível no hover */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(conv.id);
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
              aria-label="Apagar conversa"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Verificar que o arquivo compila**

```bash
cd apps/web && npx tsc --noEmit 2>&1 | head -20
```

Esperado: erros apenas sobre `onDelete` não passado em `inbox/page.tsx` (será corrigido na Task 4).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/inbox/conversation-list.tsx
git commit -m "feat: adicionar botão de deletar no hover da lista de conversas"
```

---

## Task 3: `SidePanel` — botão de deletar no rodapé

**Files:**
- Modify: `apps/web/src/components/inbox/side-panel.tsx`

- [ ] **Step 1: Adicionar prop `onDelete` e botão no rodapé**

Substituir a interface `SidePanelProps` e o componente `SidePanel` em `apps/web/src/components/inbox/side-panel.tsx`:

Primeiro, adicionar `Trash2` no import do lucide-react:

```typescript
import { Phone, User, Trash2 } from "lucide-react";
```

Depois, substituir a interface:

```typescript
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
  onDelete: () => void;
}
```

Depois, substituir o export do componente, adicionando `onDelete` nos parâmetros e o botão no final do JSX (antes do fechamento do `<div>` principal):

```typescript
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

      {/* Apagar conversa */}
      <div className="p-4 mt-auto">
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

- [ ] **Step 2: Verificar que o arquivo compila**

```bash
cd apps/web && npx tsc --noEmit 2>&1 | head -20
```

Esperado: erros apenas sobre `onDelete` não passado pelo `ChatPanel` (será corrigido na Task 4).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/inbox/side-panel.tsx
git commit -m "feat: adicionar botão de apagar conversa no side panel"
```

---

## Task 4: `inbox/page.tsx` — orquestração do delete

**Files:**
- Modify: `apps/web/src/app/(dashboard)/inbox/page.tsx`

- [ ] **Step 1: Verificar como `ChatPanel` passa `SidePanel`**

Abrir `apps/web/src/components/inbox/chat-panel.tsx` e verificar se ele renderiza `SidePanel` diretamente. Se sim, `onDelete` precisa ser passado por `ChatPanel` também.

```bash
grep -n "SidePanel\|onDelete" apps/web/src/components/inbox/chat-panel.tsx
```

- [ ] **Step 2: Adicionar `onDelete` prop em `ChatPanel` (se necessário)**

Se `ChatPanel` renderiza `SidePanel`, adicionar a prop `onDelete: () => void` na interface de `ChatPanel` e repassar para `SidePanel`.

Abrir `apps/web/src/components/inbox/chat-panel.tsx`, localizar a interface de props e adicionar:

```typescript
onDelete: () => void;
```

E no JSX onde `SidePanel` é renderizado, passar `onDelete={onDelete}`.

- [ ] **Step 3: Adicionar `handleDelete` em `inbox/page.tsx`**

No componente `InboxContent`, adicionar a função `handleDelete` após `handleSelect`:

```typescript
const handleDelete = useCallback(async (id: string) => {
  try {
    await apiFetch(`/conversations/${id}`, { method: "DELETE" });
  } catch (err) {
    alert(err instanceof Error ? err.message : "Erro ao apagar conversa");
    return;
  }

  setConversations((prev) => {
    const idx = prev.findIndex((c) => c.id === id);
    const next = prev[idx + 1] ?? prev[idx - 1] ?? null;
    // Navegar antes de atualizar o estado para evitar flash
    if (id === selectedId) {
      if (next) {
        router.push(`/inbox?id=${next.id}`);
      } else {
        router.push("/inbox");
      }
    }
    return prev.filter((c) => c.id !== id);
  });
}, [selectedId, router]);
```

- [ ] **Step 4: Adicionar import de `apiFetch`**

No topo de `inbox/page.tsx`, adicionar o import se não existir:

```typescript
import { apiFetch } from "@/lib/api";
```

- [ ] **Step 5: Passar `onDelete` para `ConversationList` e `ChatPanel`**

Localizar onde `ConversationList` é renderizado (dentro de `listContent()`) e adicionar a prop:

```typescript
<ConversationList
  conversations={filtered}
  selectedId={selectedId}
  onSelect={handleSelect}
  onDelete={handleDelete}
/>
```

Localizar onde `ChatPanel` é renderizado e adicionar:

```typescript
<ChatPanel
  conversationId={selectedId}
  onDelete={() => handleDelete(selectedId!)}
/>
```

- [ ] **Step 6: Verificar que tudo compila sem erros**

```bash
cd apps/web && npx tsc --noEmit 2>&1
```

Esperado: sem erros.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app/(dashboard)/inbox/page.tsx apps/web/src/components/inbox/chat-panel.tsx
git commit -m "feat: orquestrar deleção de conversa no inbox com navegação automática"
```

---

## Task 5: Push e deploy

- [ ] **Step 1: Push para origin/main**

```bash
git push origin main
```

- [ ] **Step 2: Verificar build no Easypanel**

Após push, acompanhar o build no Easypanel. Esperado: build bem-sucedido, sem erros TypeScript.

- [ ] **Step 3: Smoke test manual**

1. Abrir o inbox no browser.
2. Passar o mouse sobre uma conversa — ícone de lixeira deve aparecer no canto direito.
3. Clicar no ícone de lixeira em uma conversa que NÃO está selecionada → conversa some da lista, chat não muda.
4. Selecionar uma conversa, abrir o side panel, clicar "Apagar conversa" → conversa some, próxima é selecionada automaticamente.
5. Se era a última conversa, painel de chat fecha (volta para tela vazia).
