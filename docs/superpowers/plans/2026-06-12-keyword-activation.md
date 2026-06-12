# Keyword Activation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que agentes só respondam após o contato enviar uma mensagem que faça match com pelo menos uma regex de ativação configurada.

**Architecture:** Nova coluna `activation_keywords text[]` no agente + `is_keyword_activated boolean` na conversa. O webhook busca o agente para calcular o valor inicial da conversa. O worker executa um guard após `getRecentMessages` mas antes do media preprocessing, curto-circuitando silenciosamente mensagens que não ativam.

**Tech Stack:** PostgreSQL (Supabase migrations), TypeScript, Zod, Vitest, React/react-hook-form

---

## Mapeamento de Arquivos

| Ação | Arquivo |
|------|---------|
| Criar | `supabase/migrations/00021_agent_keyword_activation.sql` |
| Modificar | `packages/shared/src/types/agent.ts` |
| Modificar | `packages/shared/src/types/conversation.ts` |
| Modificar | `packages/shared/src/schemas/agent.ts` |
| Modificar | `packages/shared/src/__tests__/schemas.test.ts` |
| Criar | `apps/web/src/components/ui/chips-input.tsx` |
| Modificar | `apps/web/src/components/inbox/tags-input.tsx` |
| Modificar | `apps/web/src/components/agents/agent-form.tsx` |
| Modificar | `apps/api/src/services/conversation.service.ts` |
| Modificar | `apps/api/src/routes/webhooks/evolution.ts` |
| Modificar | `apps/worker/src/workers/process-message.ts` |
| Modificar | `apps/worker/src/workers/__tests__/process-message.test.ts` |

---

## Task 1: Migration do banco de dados

**Files:**
- Criar: `supabase/migrations/00021_agent_keyword_activation.sql`

- [ ] **Step 1: Criar o arquivo de migração**

```sql
-- supabase/migrations/00021_agent_keyword_activation.sql

-- Lista de regexes de ativação no agente (vazia = sempre ativo)
ALTER TABLE agents ADD COLUMN activation_keywords text[] NOT NULL DEFAULT '{}';

-- Estado de ativação por conversa
-- DEFAULT false: conversas começam não-ativadas
-- UPDATE abaixo ativa imediatamente as que pertencem a agentes sem keywords
ALTER TABLE conversations ADD COLUMN is_keyword_activated boolean NOT NULL DEFAULT false;

-- Backfill: ativar conversas de agentes sem keywords (comportamento atual preservado)
UPDATE conversations
SET is_keyword_activated = true
WHERE agent_id IN (
  SELECT id FROM agents WHERE activation_keywords = '{}'
);
```

- [ ] **Step 2: Aplicar a migração localmente**

```bash
npx supabase db push
```

Esperado: migração aplicada sem erro.

- [ ] **Step 3: Verificar colunas no DB**

```bash
npx supabase db diff
```

Esperado: diff vazio (migração já aplicada).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/00021_agent_keyword_activation.sql
git commit -m "feat: adicionar colunas activation_keywords e is_keyword_activated"
```

---

## Task 2: Tipos compartilhados e schema Zod

**Files:**
- Modificar: `packages/shared/src/types/agent.ts`
- Modificar: `packages/shared/src/types/conversation.ts`
- Modificar: `packages/shared/src/schemas/agent.ts`
- Modificar: `packages/shared/src/__tests__/schemas.test.ts`

- [ ] **Step 1: Escrever os testes que devem falhar**

Em `packages/shared/src/__tests__/schemas.test.ts`, adicionar após os testes existentes:

```ts
describe("activation_keywords", () => {
  it("aceita array vazio por default", () => {
    const result = createAgentSchema.safeParse(valid);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.activation_keywords).toEqual([]);
    }
  });

  it("aceita array de strings não-vazias", () => {
    const result = createAgentSchema.safeParse({
      ...valid,
      activation_keywords: ["^oi$", "suporte"],
    });
    expect(result.success).toBe(true);
  });

  it("rejeita string vazia no array", () => {
    const result = createAgentSchema.safeParse({
      ...valid,
      activation_keywords: [""],
    });
    expect(result.success).toBe(false);
  });

  it("rejeita string só com espaços no array", () => {
    const result = createAgentSchema.safeParse({
      ...valid,
      activation_keywords: ["   "],
    });
    // "   " tem length > 0, então passa .min(1) — o trim é feito no worker
    // Este teste documenta que espaços puros PASSAM no schema (o worker filtra depois)
    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar os testes — confirmar que falham**

```bash
pnpm --filter @aula-agente/shared test
```

Esperado: FAIL — `activation_keywords` não existe no schema ainda.

- [ ] **Step 3: Atualizar o tipo `Agent`**

Em `packages/shared/src/types/agent.ts`, adicionar o campo:

```ts
export interface Agent {
  id: string;
  organization_id: string;
  name: string;
  description: string;
  system_prompt: string;
  model: string;
  provider: LLMProvider;
  temperature: number;
  max_tokens: number;
  max_steps: number;
  tools_config: ToolsConfig;
  is_active: boolean;
  activation_keywords: string[];   // ← novo
  created_at: string;
  updated_at: string;
}
```

- [ ] **Step 4: Atualizar o tipo `Conversation`**

Em `packages/shared/src/types/conversation.ts`, adicionar o campo:

```ts
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
  is_keyword_activated: boolean;   // ← novo
  created_at: string;
  updated_at: string;
}
```

- [ ] **Step 5: Atualizar o schema Zod**

Em `packages/shared/src/schemas/agent.ts`:

```ts
import { z } from "zod";

export const toolsConfigSchema = z.object({
  search_knowledge: z.boolean().default(true),
  search_faq: z.boolean().default(true),
});

export const createAgentSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(50000).default(""),
  system_prompt: z.string().min(1).max(50000),
  model: z.string().min(1),
  provider: z.enum(["openai", "anthropic", "google"]),
  temperature: z.number().min(0).max(2).default(0.7),
  max_tokens: z.number().int().min(1).max(16384).default(1024),
  max_steps: z.number().int().min(1).max(20).default(5),
  tools_config: toolsConfigSchema.default({ search_knowledge: true, search_faq: true }),
  activation_keywords: z.array(z.string().min(1)).default([]),   // ← novo
});

export const updateAgentSchema = createAgentSchema.partial();
```

- [ ] **Step 6: Rodar os testes — confirmar que passam**

```bash
pnpm --filter @aula-agente/shared test
```

Esperado: PASS em todos os testes.

- [ ] **Step 7: Typecheck**

```bash
pnpm --filter @aula-agente/shared typecheck
```

Esperado: sem erros.

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/types/agent.ts packages/shared/src/types/conversation.ts packages/shared/src/schemas/agent.ts packages/shared/src/__tests__/schemas.test.ts
git commit -m "feat: adicionar activation_keywords ao Agent e is_keyword_activated ao Conversation"
```

---

## Task 3: Componente controlado `ChipsInput`

**Files:**
- Criar: `apps/web/src/components/ui/chips-input.tsx`
- Modificar: `apps/web/src/components/inbox/tags-input.tsx`

O `TagsInput` existente tem a lógica de UI de chips mas está acoplado ao Supabase. Extraímos a parte visual como componente controlado (`value`/`onChange`), e o `TagsInput` passa a usá-lo.

- [ ] **Step 1: Criar `ChipsInput` controlado**

Criar `apps/web/src/components/ui/chips-input.tsx`:

```tsx
"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { Input } from "@/components/ui/input";

interface ChipsInputProps {
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
}

export function ChipsInput({ value, onChange, placeholder = "Adicionar..." }: ChipsInputProps) {
  const [input, setInput] = useState("");

  const add = () => {
    const trimmed = input.trim();
    if (!trimmed || value.includes(trimmed)) return;
    onChange([...value, trimmed]);
    setInput("");
  };

  const remove = (chip: string) => {
    onChange(value.filter((c) => c !== chip));
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {value.map((chip) => (
          <span
            key={chip}
            className="flex items-center gap-1 rounded-md border border-border bg-elevated px-2 py-0.5 text-[11px] font-medium text-foreground"
          >
            {chip}
            <button
              type="button"
              onClick={() => remove(chip)}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </span>
        ))}
      </div>
      <Input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); add(); }
          if (e.key === ",") { e.preventDefault(); add(); }
        }}
        placeholder={placeholder}
        className="h-7 bg-muted border-border text-xs placeholder:text-muted-foreground"
      />
    </div>
  );
}
```

- [ ] **Step 2: Refatorar `TagsInput` para usar `ChipsInput`**

Substituir o conteúdo de `apps/web/src/components/inbox/tags-input.tsx`:

```tsx
"use client";

import { createClient } from "@/lib/supabase/client";
import { ChipsInput } from "@/components/ui/chips-input";

interface TagsInputProps {
  conversationId: string;
  tags: string[];
  onUpdate: () => void;
}

export function TagsInput({ conversationId, tags, onUpdate }: TagsInputProps) {
  const handleChange = async (newTags: string[]) => {
    const supabase = createClient();
    await supabase.from("conversations").update({ tags: newTags }).eq("id", conversationId);
    onUpdate();
  };

  return (
    <ChipsInput
      value={tags}
      onChange={handleChange}
      placeholder="Adicionar tag..."
    />
  );
}
```

- [ ] **Step 3: Typecheck para garantir que TagsInput ainda compila**

```bash
pnpm --filter @aula-agente/web typecheck
```

Esperado: sem erros.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/ui/chips-input.tsx apps/web/src/components/inbox/tags-input.tsx
git commit -m "feat: extrair ChipsInput controlado e refatorar TagsInput para usá-lo"
```

---

## Task 4: Campo `activation_keywords` no formulário de agentes

**Files:**
- Modificar: `apps/web/src/components/agents/agent-form.tsx`

- [ ] **Step 1: Adicionar `activation_keywords` ao schema do form**

Em `agent-form.tsx`, na linha onde `agentFormSchema` é definido, adicionar o campo:

```ts
const agentFormSchema = createAgentSchema.extend({
  is_active: z.boolean().default(true),
  // activation_keywords já vem do createAgentSchema com default []
});
```

O `createAgentSchema` já exporta `activation_keywords: z.array(z.string().min(1)).default([])`, então nenhuma mudança no `.extend()` é necessária — o campo já está disponível.

Adicionar ao `defaultValues`:

```ts
defaultValues: {
  name: "",
  description: "",
  system_prompt: "",
  model: "gpt-4.1-mini",
  provider: "openai",
  temperature: 0.7,
  max_tokens: 1024,
  max_steps: 5,
  tools_config: { search_knowledge: true, search_faq: true },
  activation_keywords: [],   // ← novo
  is_active: true,
  ...defaultValues,
},
```

- [ ] **Step 2: Adicionar o import do `ChipsInput`**

No topo de `agent-form.tsx`, adicionar:

```ts
import { ChipsInput } from "@/components/ui/chips-input";
```

- [ ] **Step 3: Adicionar a seção de ativação entre `description` e `system_prompt`**

Dentro do card "Informações Básicas", após o bloco do campo `description` (que termina na tag `</div>` após o contador de chars) e antes do bloco do campo `system_prompt`, inserir:

```tsx
<div className="space-y-2">
  <Label>Ativação por Palavra-chave</Label>
  <ChipsInput
    value={form.watch("activation_keywords") ?? []}
    onChange={(v) => form.setValue("activation_keywords", v, { shouldDirty: true })}
    placeholder="Digite uma regex e pressione Enter..."
  />
  <p className="text-xs text-muted-foreground">
    Deixe vazio para o agente sempre responder. Cada entrada é uma regex (case-insensitive).
    Evite padrões que matchem placeholders de mídia como <code>[áudio]</code>.
  </p>
</div>
```

- [ ] **Step 4: Typecheck**

```bash
pnpm --filter @aula-agente/web typecheck
```

Esperado: sem erros.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/agents/agent-form.tsx
git commit -m "feat: adicionar campo activation_keywords no formulário de agentes"
```

---

## Task 5: Webhook e `ensureConversation`

**Files:**
- Modificar: `apps/api/src/services/conversation.service.ts`
- Modificar: `apps/api/src/routes/webhooks/evolution.ts`

- [ ] **Step 1: Atualizar `EnsureConversationParams` e `ensureConversation`**

Substituir o conteúdo de `apps/api/src/services/conversation.service.ts`:

```ts
import { getAdminClient } from "@aula-agente/database";
import {
  findOpenConversation,
  createConversation,
  updateConversation,
  upsertContact,
} from "@aula-agente/database";

interface EnsureConversationParams {
  organizationId: string;
  agentId: string;
  instanceId: string;
  phone: string;
  contactName: string | null;
  contactPhotoUrl: string | null;
  isKeywordActivated: boolean;   // ← novo: false quando agente tem keywords
}

export async function ensureConversation(params: EnsureConversationParams) {
  const db = getAdminClient();

  const contact = await upsertContact(
    db,
    params.organizationId,
    params.phone,
    params.contactName,
    params.contactPhotoUrl
  );

  const existing = await findOpenConversation(db, contact.id, params.agentId);

  if (existing) {
    return { conversation: existing, contact, isNew: false };
  }

  const conversation = await createConversation(db, {
    organization_id: params.organizationId,
    agent_id: params.agentId,
    evolution_instance_id: params.instanceId,
    contact_id: contact.id,
    status: "open",
    is_human_takeover: false,
    human_takeover_at: null,
    assigned_to: null,
    tags: [],
    last_message_at: new Date().toISOString(),
    is_keyword_activated: params.isKeywordActivated,   // ← novo
  });

  return { conversation, contact, isNew: true };
}

export async function setHumanTakeover(conversationId: string, takeover: boolean) {
  const db = getAdminClient();
  return updateConversation(db, conversationId, {
    is_human_takeover: takeover,
    human_takeover_at: takeover ? new Date().toISOString() : null,
  });
}
```

- [ ] **Step 2: Atualizar o webhook para buscar o agente e calcular `isKeywordActivated`**

Em `apps/api/src/routes/webhooks/evolution.ts`, adicionar o import de `getAgentById`:

```ts
import { getAdminClient, getInstanceByInstanceId, getAgentById } from "@aula-agente/database";
```

Depois, no handler do webhook, logo após resolver `agentId` (após a linha `const agentId = instance.active_agent_id;`), adicionar a busca do agente:

```ts
const organizationId = instance.organization_id;
const agentId = instance.active_agent_id;

// Busca o agente para calcular o estado inicial de ativação da conversa
const agent = await getAgentById(getAdminClient(), agentId);
```

E na chamada de `ensureConversation`, passar `isKeywordActivated`:

```ts
const { conversation } = await ensureConversation({
  organizationId,
  agentId,
  instanceId: instance.id,
  phone,
  contactName,
  contactPhotoUrl: null,
  isKeywordActivated: agent.activation_keywords.length === 0,
});
```

- [ ] **Step 3: Typecheck da API**

```bash
pnpm --filter @aula-agente/api typecheck
```

Esperado: sem erros.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/services/conversation.service.ts apps/api/src/routes/webhooks/evolution.ts
git commit -m "feat: passar is_keyword_activated ao criar conversa via webhook"
```

---

## Task 6: Keyword guard no worker

**Files:**
- Modificar: `apps/worker/src/workers/process-message.ts`
- Modificar: `apps/worker/src/workers/__tests__/process-message.test.ts`

### 6a — Extrair e testar `matchesKeyword`

- [ ] **Step 1: Escrever os testes para `matchesKeyword`**

Em `apps/worker/src/workers/__tests__/process-message.test.ts`, adicionar ao final do arquivo (antes dos describe existentes):

```ts
import { matchesKeyword } from "../process-message";

describe("matchesKeyword", () => {
  it("retorna false quando array de keywords está vazio", () => {
    expect(matchesKeyword("oi", [])).toBe(false);
  });

  it("retorna true quando mensagem faz match com uma keyword", () => {
    expect(matchesKeyword("Preciso de suporte urgente", ["suporte"])).toBe(true);
  });

  it("matching é case-insensitive", () => {
    expect(matchesKeyword("SUPORTE", ["suporte"])).toBe(true);
  });

  it("suporta regex completa", () => {
    expect(matchesKeyword("oi", ["^oi$"])).toBe(true);
    expect(matchesKeyword("oioi", ["^oi$"])).toBe(false);
  });

  it("retorna false quando mensagem não faz match com nenhuma keyword", () => {
    expect(matchesKeyword("bom dia", ["suporte", "ajuda"])).toBe(false);
  });

  it("ignora silenciosamente regex inválida e continua com as válidas", () => {
    // "[abc" é regex inválida; "ajuda" é válida
    expect(matchesKeyword("preciso de ajuda", ["[abc", "ajuda"])).toBe(true);
  });

  it("ignora regex inválida e retorna false se nenhuma válida fizer match", () => {
    expect(matchesKeyword("oi", ["[abc"])).toBe(false);
  });

  it("filtra keywords com apenas espaços antes de testar", () => {
    // "   " com trim vira "", deve ser ignorada
    expect(matchesKeyword("oi", ["   "])).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar os testes — confirmar que falham**

```bash
pnpm --filter @aula-agente/worker test
```

Esperado: FAIL — `matchesKeyword` não exportada ainda.

- [ ] **Step 3: Exportar `matchesKeyword` no worker**

Em `apps/worker/src/workers/process-message.ts`, adicionar a função logo após os imports:

```ts
export function matchesKeyword(content: string, keywords: string[]): boolean {
  const valid = keywords.filter((k) => k.trim().length > 0);
  return valid.some((keyword) => {
    try {
      return new RegExp(keyword, "i").test(content);
    } catch {
      console.warn(`[keyword-gate] regex inválida ignorada: ${keyword}`);
      return false;
    }
  });
}
```

- [ ] **Step 4: Rodar apenas os testes de `matchesKeyword` — confirmar que passam**

```bash
pnpm --filter @aula-agente/worker test
```

Esperado: PASS nos testes de `matchesKeyword`.

### 6b — Integrar o guard no processor

- [ ] **Step 5: Escrever os testes de integração do keyword guard**

Em `apps/worker/src/workers/__tests__/process-message.test.ts`, atualizar os fixtures existentes para incluir os novos campos e adicionar um novo `describe`:

Atualizar `activeAgent` para incluir `activation_keywords`:

```ts
const activeAgent = {
  id: "agent-1",
  provider: "openai",
  model: "gpt-4o-mini",
  system_prompt: "...",
  temperature: 0.7,
  max_tokens: 1024,
  max_steps: 5,
  tools_config: { search_knowledge: false, search_faq: false },
  is_active: true,
  activation_keywords: [],   // ← novo: sem keywords por default
};
```

Atualizar `conversation` para incluir `is_keyword_activated`:

```ts
const conversation = {
  id: "conv-1",
  is_human_takeover: false,
  is_keyword_activated: true,   // ← novo: ativada por default nos testes existentes
  evolution_instance_id: "inst-1",
  contacts: { phone: "5511999999999" },
};
```

Adicionar o novo describe ao final:

```ts
describe("keyword gate", () => {
  it("não filtra quando agente não tem keywords", async () => {
    // activeAgent já tem activation_keywords: []
    await runJob();
    expect(createMessage).toHaveBeenCalled();
  });

  it("não filtra quando conversa já está ativada", async () => {
    vi.mocked(getAgentById).mockResolvedValue({
      ...activeAgent,
      activation_keywords: ["suporte"],
    } as never);
    vi.mocked(getConversationById).mockResolvedValue({
      ...conversation,
      is_keyword_activated: true,
    } as never);
    await runJob();
    expect(createMessage).toHaveBeenCalled();
  });

  it("filtra silenciosamente quando keyword não faz match", async () => {
    vi.mocked(getAgentById).mockResolvedValue({
      ...activeAgent,
      activation_keywords: ["^suporte$"],
    } as never);
    vi.mocked(getConversationById).mockResolvedValue({
      ...conversation,
      is_keyword_activated: false,
    } as never);
    // mensagem padrão é "Olá" — não faz match com "^suporte$"
    await runJob();
    expect(createMessage).not.toHaveBeenCalled();
  });

  it("ativa conversa e processa quando keyword faz match", async () => {
    const { updateConversation } = await import("@aula-agente/database");
    vi.mocked(getAgentById).mockResolvedValue({
      ...activeAgent,
      activation_keywords: ["olá"],
    } as never);
    vi.mocked(getConversationById).mockResolvedValue({
      ...conversation,
      is_keyword_activated: false,
    } as never);
    // mensagem padrão é "Olá" — faz match com "olá" (case-insensitive)
    await runJob();
    expect(updateConversation).toHaveBeenCalledWith(
      expect.anything(),
      "conv-1",
      { is_keyword_activated: true }
    );
    expect(createMessage).toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Rodar os testes — confirmar que os novos falham**

```bash
pnpm --filter @aula-agente/worker test
```

Esperado: os 4 novos testes de "keyword gate" falham.

- [ ] **Step 7: Implementar o keyword guard no worker**

Em `apps/worker/src/workers/process-message.ts`, dentro do handler do `Worker`, após a busca de `recentMessages` e a extração de `currentMessage`, e antes do bloco de media preprocessing (a linha `if (currentMessage.media_type === "audio" || ...)`), adicionar:

```ts
// Keyword activation guard
if (
  agent.activation_keywords.length > 0 &&
  !(conversation as unknown as { is_keyword_activated: boolean }).is_keyword_activated
) {
  if (!matchesKeyword(currentMessage.content, agent.activation_keywords)) {
    console.log(`[keyword-gate] Conversa ${conversationId} aguardando keyword — mensagem ignorada`);
    return;
  }
  await updateConversation(db, conversationId, { is_keyword_activated: true });
  console.log(`[keyword-gate] Conversa ${conversationId} ativada por keyword`);
}
```

**Nota sobre o cast:** o worker recebe `conversation` como `Record<string, unknown>` (cast existente na linha 165). O cast `(conversation as unknown as { is_keyword_activated: boolean })` é seguro aqui pois sabemos que o campo existe no DB. Uma refatoração completa do tipo está fora do escopo deste PR (exigiria mexer no tipo de retorno do `getConversationById` que retorna joined tables).

- [ ] **Step 8: Rodar todos os testes do worker — confirmar que passam**

```bash
pnpm --filter @aula-agente/worker test
```

Esperado: PASS em todos os testes (incluindo os existentes de `is_active`, `is_human_takeover`, caminho feliz, e lock).

- [ ] **Step 9: Typecheck do worker**

```bash
pnpm --filter @aula-agente/worker typecheck
```

Esperado: sem erros.

- [ ] **Step 10: Commit**

```bash
git add apps/worker/src/workers/process-message.ts apps/worker/src/workers/__tests__/process-message.test.ts
git commit -m "feat: adicionar keyword guard no worker (matchesKeyword + integration tests)"
```

---

## Task 7: Typecheck e testes globais

- [ ] **Step 1: Rodar typecheck em todos os pacotes**

```bash
pnpm typecheck
```

Esperado: sem erros em nenhum pacote.

- [ ] **Step 2: Rodar todos os testes**

```bash
pnpm test
```

Esperado: PASS em todos os pacotes com testes (`shared`, `worker`).

- [ ] **Step 3: Commit final se houver ajustes**

Se houver correções menores após os passos acima:

```bash
git add -p
git commit -m "fix: ajustes pós-typecheck no keyword activation"
```
