# Technical Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir 4 falhas técnicas em sequência: `max_steps` configurável, embeddings sem dependência obrigatória do OpenAI, inbox sem refetch total no Realtime, e suite de testes com Vitest.

**Architecture:** Fix 1–3 são mudanças cirúrgicas em arquivos existentes. Fix 4 adiciona infraestrutura de testes (Vitest) e 6 arquivos de teste cobrindo os caminhos críticos do worker e da API.

**Tech Stack:** TypeScript, Vitest, Supabase, BullMQ, Fastify, Next.js, Vercel AI SDK, pnpm workspaces + Turborepo

---

## Mapa de arquivos

| Ação | Arquivo |
|---|---|
| Criar | `supabase/migrations/00020_add_max_steps_to_agents.sql` |
| Modificar | `packages/shared/src/types/agent.ts` |
| Modificar | `packages/shared/src/schemas/agent.ts` |
| Modificar | `apps/worker/src/agents/agent-runner.ts` |
| Modificar | `apps/web/src/components/agents/agent-form.tsx` |
| Modificar | `apps/worker/src/lib/vault.ts` |
| Modificar | `apps/worker/src/workers/process-document.ts` |
| Modificar | `apps/web/src/app/(dashboard)/inbox/page.tsx` |
| Modificar | `apps/worker/package.json` |
| Modificar | `apps/api/package.json` |
| Modificar | `packages/shared/package.json` |
| Criar | `apps/worker/src/embeddings/__tests__/chunker.test.ts` |
| Criar | `apps/worker/src/agents/__tests__/agent-runner.test.ts` |
| Criar | `apps/worker/src/workers/__tests__/process-message.test.ts` |
| Criar | `apps/worker/src/workers/__tests__/process-document.test.ts` |
| Criar | `apps/api/src/routes/webhooks/__tests__/evolution.test.ts` |
| Criar | `packages/shared/src/__tests__/schemas.test.ts` |

---

## Task 1: Migration + shared types + schemas (Fix 1 — max_steps)

**Files:**
- Create: `supabase/migrations/00020_add_max_steps_to_agents.sql`
- Modify: `packages/shared/src/types/agent.ts`
- Modify: `packages/shared/src/schemas/agent.ts`

- [ ] **Step 1: Criar a migration**

Crie o arquivo `supabase/migrations/00020_add_max_steps_to_agents.sql` com o conteúdo:

```sql
ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS max_steps INTEGER NOT NULL DEFAULT 5;

ALTER TABLE agents
  ADD CONSTRAINT agents_max_steps_range CHECK (max_steps BETWEEN 1 AND 20);
```

- [ ] **Step 2: Aplicar a migration**

```bash
npx supabase db push
```

Saída esperada: `Applying migration 00020_add_max_steps_to_agents.sql... done`

Se usar Supabase local em dev: `npx supabase migration up`

- [ ] **Step 3: Adicionar `max_steps` ao type Agent**

Em `packages/shared/src/types/agent.ts`, adicionar o campo após `tools_config`:

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
  created_at: string;
  updated_at: string;
}
```

- [ ] **Step 4: Adicionar `max_steps` ao schema Zod**

Em `packages/shared/src/schemas/agent.ts`, adicionar após `max_tokens`:

```ts
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
});
```

- [ ] **Step 5: Verificar typecheck**

```bash
pnpm --filter @aula-agente/shared typecheck
```

Saída esperada: sem erros.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/00020_add_max_steps_to_agents.sql packages/shared/src/types/agent.ts packages/shared/src/schemas/agent.ts
git commit -m "feat: adicionar max_steps configurável ao agente (migration + tipos + schema)"
```

---

## Task 2: Worker — usar agent.max_steps (Fix 1)

**Files:**
- Modify: `apps/worker/src/agents/agent-runner.ts:68-79`

- [ ] **Step 1: Substituir maxSteps hardcoded**

Em `apps/worker/src/agents/agent-runner.ts`, dentro da chamada `generateText`, substituir `maxSteps: 5` por `maxSteps: agent.max_steps`:

```ts
const result = await generateText({
  model,
  system: agent.system_prompt,
  messages: [
    ...history,
    { role: "user", content: currentMessage.content },
  ],
  tools,
  maxSteps: agent.max_steps,
  temperature: agent.temperature,
  maxTokens: agent.max_tokens,
});
```

- [ ] **Step 2: Verificar typecheck**

```bash
pnpm --filter @aula-agente/worker typecheck
```

Saída esperada: sem erros.

- [ ] **Step 3: Commit**

```bash
git add apps/worker/src/agents/agent-runner.ts
git commit -m "feat: usar agent.max_steps no agent-runner em vez de valor fixo 5"
```

---

## Task 3: Web — campo max_steps no formulário (Fix 1)

**Files:**
- Modify: `apps/web/src/components/agents/agent-form.tsx`

- [ ] **Step 1: Adicionar default de max_steps no useForm**

Em `apps/web/src/components/agents/agent-form.tsx`, no objeto `defaultValues` do `useForm`:

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
  is_active: true,
  ...defaultValues,
},
```

- [ ] **Step 2: Adicionar campo no Card "Modelo"**

Dentro do `<Card>` com `<CardTitle>Modelo</CardTitle>`, após o grid de temperatura e max_tokens, adicionar:

```tsx
<div className="space-y-2">
  <Label>Máximo de passos ({form.watch("max_steps")})</Label>
  <Input
    type="range"
    min="1"
    max="20"
    step="1"
    {...form.register("max_steps", { valueAsNumber: true })}
  />
  <p className="text-xs text-muted-foreground">
    Número máximo de iterações de ferramentas por resposta (1–20)
  </p>
</div>
```

O grid completo do Card "Modelo" ficará assim:

```tsx
<div className="grid grid-cols-2 gap-4">
  <div className="space-y-2">
    <Label>Temperatura ({form.watch("temperature")})</Label>
    <Input
      type="range"
      min="0"
      max="2"
      step="0.1"
      {...form.register("temperature", { valueAsNumber: true })}
    />
  </div>

  <div className="space-y-2">
    <Label>Max Tokens</Label>
    <Input
      type="number"
      {...form.register("max_tokens", { valueAsNumber: true })}
    />
  </div>
</div>

<div className="space-y-2">
  <Label>Máximo de passos ({form.watch("max_steps")})</Label>
  <Input
    type="range"
    min="1"
    max="20"
    step="1"
    {...form.register("max_steps", { valueAsNumber: true })}
  />
  <p className="text-xs text-muted-foreground">
    Número máximo de iterações de ferramentas por resposta (1–20)
  </p>
</div>
```

- [ ] **Step 3: Verificar typecheck**

```bash
pnpm --filter @aula-agente/web typecheck
```

Saída esperada: sem erros.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/agents/agent-form.tsx
git commit -m "feat: adicionar campo max_steps no formulário do agente"
```

---

## Task 4: resolveEmbeddingApiKey + process-document (Fix 2)

**Files:**
- Modify: `apps/worker/src/lib/vault.ts`
- Modify: `apps/worker/src/workers/process-document.ts`

- [ ] **Step 1: Adicionar resolveEmbeddingApiKey no vault**

Em `apps/worker/src/lib/vault.ts`, adicionar a função ao final do arquivo (após `resolveApiKey`):

```ts
export async function resolveEmbeddingApiKey(organizationId: string): Promise<string> {
  try {
    return await resolveApiKey(organizationId, "openai");
  } catch {
    const fallback = process.env.PLATFORM_OPENAI_EMBEDDING_KEY;
    if (!fallback) {
      throw new Error(
        `No OpenAI key available for embeddings in org ${organizationId}. ` +
        `Add an OpenAI secret to the org or set PLATFORM_OPENAI_EMBEDDING_KEY.`
      );
    }
    return fallback;
  }
}
```

- [ ] **Step 2: Usar resolveEmbeddingApiKey no process-document**

Em `apps/worker/src/workers/process-document.ts`, atualizar o import e substituir a chamada:

```ts
import { resolveEmbeddingApiKey } from "../lib/vault";
```

Substituir a linha 59:
```ts
// antes
const apiKey = await resolveApiKey(organizationId, "openai");

// depois
const apiKey = await resolveEmbeddingApiKey(organizationId);
```

Remover `resolveApiKey` do import se não for mais usado no arquivo (verifique — ele não é usado em mais nenhum lugar em process-document.ts).

O import atualizado fica:
```ts
import { resolveEmbeddingApiKey } from "../lib/vault";
```

- [ ] **Step 3: Adicionar PLATFORM_OPENAI_EMBEDDING_KEY ao .env.example**

No arquivo `.env.example` (ou criar se não existir), adicionar:

```env
# Chave OpenAI usada como fallback para embeddings quando a org não tem chave própria
PLATFORM_OPENAI_EMBEDDING_KEY=
```

- [ ] **Step 4: Verificar typecheck**

```bash
pnpm --filter @aula-agente/worker typecheck
```

Saída esperada: sem erros.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/lib/vault.ts apps/worker/src/workers/process-document.ts
git commit -m "feat: resolveEmbeddingApiKey com fallback para PLATFORM_OPENAI_EMBEDDING_KEY"
```

---

## Task 5: Inbox sem refetch total no Realtime (Fix 3)

**Files:**
- Modify: `apps/web/src/app/(dashboard)/inbox/page.tsx`

**Contexto:** O hook `useRealtime` já passa `payload.new` como `T` nos callbacks `onInsert` e `onUpdate`. Para `onUpdate`, o payload contém apenas colunas escalares da tabela `conversations` (sem os joins `contacts` e `agents`). Para `onInsert`, precisamos buscar a conversa nova com joins via query pontual.

- [ ] **Step 1: Adicionar função de enriquecimento onInsert**

Em `apps/web/src/app/(dashboard)/inbox/page.tsx`, dentro do componente `InboxContent`, adicionar a função antes do `useRealtime`:

```ts
const handleRealtimeInsert = useCallback(async (newRow: Record<string, unknown>) => {
  if (!currentOrg) return;
  const supabase = createClient();
  const { data } = await supabase
    .from("conversations")
    .select("*, contacts(phone, name), agents(name)")
    .eq("id", newRow.id as string)
    .single();
  if (data) {
    setConversations((prev) => [data as ConversationRow, ...prev]);
  }
}, [currentOrg]);
```

- [ ] **Step 2: Adicionar função de atualização onUpdate**

Logo após `handleRealtimeInsert`, adicionar:

```ts
const handleRealtimeUpdate = useCallback((updatedRow: Record<string, unknown>) => {
  setConversations((prev) =>
    prev.map((c) =>
      c.id === updatedRow.id
        ? {
            ...c,
            status: updatedRow.status as string,
            is_human_takeover: updatedRow.is_human_takeover as boolean,
            last_message_at: updatedRow.last_message_at as string,
            tags: updatedRow.tags as string[],
            assigned_to: updatedRow.assigned_to as string | null,
          }
        : c
    )
  );
}, []);
```

- [ ] **Step 3: Substituir os callbacks no useRealtime**

Substituir o bloco `useRealtime` existente (linhas 83–89):

```ts
useRealtime({
  table: "conversations",
  filter: currentOrg ? `organization_id=eq.${currentOrg.id}` : undefined,
  onInsert: handleRealtimeInsert,
  onUpdate: handleRealtimeUpdate,
  enabled: !!currentOrg,
});
```

- [ ] **Step 4: Verificar typecheck**

```bash
pnpm --filter @aula-agente/web typecheck
```

Saída esperada: sem erros.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/(dashboard)/inbox/page.tsx
git commit -m "perf: inbox aplica patch direto no estado em vez de refetch total no Realtime"
```

---

## Task 6: Setup Vitest em worker, api e shared (Fix 4)

**Files:**
- Modify: `apps/worker/package.json`
- Modify: `apps/api/package.json`
- Modify: `packages/shared/package.json`

- [ ] **Step 1: Adicionar vitest ao worker**

Em `apps/worker/package.json`, adicionar nos scripts e devDependencies:

```json
"scripts": {
  "dev": "tsx watch src/index.ts",
  "build": "tsup",
  "start": "node dist/index.js",
  "test": "vitest run",
  "test:watch": "vitest",
  "typecheck": "tsc --noEmit",
  "lint": "echo 'no lint configured'"
},
"devDependencies": {
  "@types/node": "^22.0.0",
  "@types/ws": "^8.18.1",
  "tsx": "^4.19.0",
  "tsup": "^8.0.0",
  "typescript": "^5.7.0",
  "vitest": "^2.0.0"
}
```

- [ ] **Step 2: Adicionar vitest à api**

Em `apps/api/package.json`, adicionar nos scripts e devDependencies:

```json
"scripts": {
  "dev": "tsx watch src/server.ts",
  "build": "tsup",
  "start": "node dist/server.js",
  "test": "vitest run",
  "test:watch": "vitest",
  "typecheck": "tsc --noEmit",
  "lint": "echo 'no lint configured'"
},
"devDependencies": {
  "@types/node": "^22.0.0",
  "@types/ws": "^8.18.1",
  "tsup": "^8.0.0",
  "tsx": "^4.19.0",
  "typescript": "^5.7.0",
  "vitest": "^2.0.0"
}
```

- [ ] **Step 3: Adicionar vitest ao shared**

Em `packages/shared/package.json`, adicionar nos scripts e devDependencies. Primeiro verifique o arquivo atual — adicione sem sobrescrever campos existentes:

```json
"scripts": {
  "test": "vitest run",
  "test:watch": "vitest",
  "typecheck": "tsc --noEmit"
},
"devDependencies": {
  "typescript": "^5.7.0",
  "vitest": "^2.0.0"
}
```

- [ ] **Step 4: Instalar dependências**

```bash
pnpm install
```

Saída esperada: lockfile atualizado sem erros.

- [ ] **Step 5: Verificar que turbo.json já tem o task test**

Abra `turbo.json` e confirme que o bloco `test` existe:

```json
"test": {
  "dependsOn": ["^build"],
  "outputs": []
}
```

Se não existir, adicionar. Se já existir (como está atualmente), não alterar.

- [ ] **Step 6: Commit**

```bash
git add apps/worker/package.json apps/api/package.json packages/shared/package.json pnpm-lock.yaml
git commit -m "chore: adicionar vitest ao worker, api e shared"
```

---

## Task 7: Teste do chunker (Fix 4)

**Files:**
- Create: `apps/worker/src/embeddings/__tests__/chunker.test.ts`

- [ ] **Step 1: Criar o arquivo de teste**

Crie `apps/worker/src/embeddings/__tests__/chunker.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { chunkText } from "../chunker";

describe("chunkText", () => {
  it("retorna array vazio para string vazia", () => {
    const result = chunkText("");
    expect(result).toHaveLength(0);
  });

  it("retorna um único chunk para texto menor que CHUNK_SIZE (1000 chars)", () => {
    const text = "a".repeat(500);
    const result = chunkText(text);
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe(text);
    expect(result[0].metadata.chunk_index).toBe(0);
  });

  it("retorna múltiplos chunks para texto maior que CHUNK_SIZE", () => {
    const text = "palavra ".repeat(200); // ~1600 chars
    const result = chunkText(text);
    expect(result.length).toBeGreaterThan(1);
  });

  it("cada chunk tem chunk_index sequencial começando em 0", () => {
    const text = "x".repeat(3000);
    const result = chunkText(text);
    result.forEach((chunk, i) => {
      expect(chunk.metadata.chunk_index).toBe(i);
    });
  });

  it("chunks têm sobreposição (overlap de 200 chars)", () => {
    // Texto simples sem quebras de linha — overlap é exato
    const text = "a".repeat(3000);
    const result = chunkText(text);
    // O fim do chunk[0] deve aparecer no início do chunk[1]
    const endOfFirst = result[0].content.slice(-100);
    const startOfSecond = result[1].content.slice(0, 100);
    expect(endOfFirst).toBe(startOfSecond);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que passa**

```bash
pnpm --filter @aula-agente/worker test
```

Saída esperada:
```
✓ apps/worker/src/embeddings/__tests__/chunker.test.ts (5)
Test Files  1 passed (1)
Tests       5 passed (5)
```

- [ ] **Step 3: Commit**

```bash
git add apps/worker/src/embeddings/__tests__/chunker.test.ts
git commit -m "test: adicionar testes unitários para chunkText"
```

---

## Task 8: Teste do agent-runner (Fix 4)

**Files:**
- Create: `apps/worker/src/agents/__tests__/agent-runner.test.ts`

- [ ] **Step 1: Criar o arquivo de teste**

Crie `apps/worker/src/agents/__tests__/agent-runner.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock ANTES de importar o módulo testado
vi.mock("ai", () => ({
  generateText: vi.fn(),
}));
vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: vi.fn(() => vi.fn(() => "openai-model-instance")),
}));
vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: vi.fn(() => vi.fn(() => "anthropic-model-instance")),
}));
vi.mock("@ai-sdk/google", () => ({
  createGoogleGenerativeAI: vi.fn(() => vi.fn(() => "google-model-instance")),
}));
vi.mock("../tools/registry", () => ({
  buildToolsForAgent: vi.fn(() => ({})),
}));

import { generateText } from "ai";
import { runAgent } from "../agent-runner";
import { buildToolsForAgent } from "../tools/registry";

const baseAgent = {
  id: "agent-1",
  organization_id: "org-1",
  name: "Test Agent",
  description: "",
  system_prompt: "You are helpful.",
  model: "gpt-4o-mini",
  provider: "openai" as const,
  temperature: 0.7,
  max_tokens: 1024,
  max_steps: 3,
  tools_config: { search_knowledge: false, search_faq: false },
  is_active: true,
  created_at: "",
  updated_at: "",
};

const currentMessage = {
  id: "msg-1",
  conversation_id: "conv-1",
  organization_id: "org-1",
  evolution_message_id: null,
  role: "contact" as const,
  content: "Olá",
  media_url: null,
  media_type: null,
  metadata: {},
  created_at: "",
};

beforeEach(() => {
  vi.mocked(generateText).mockResolvedValue({
    text: "Olá! Como posso ajudar?",
    usage: { totalTokens: 50, promptTokens: 30, completionTokens: 20 },
    steps: [],
  } as ReturnType<typeof generateText> extends Promise<infer R> ? R : never);
});

describe("runAgent", () => {
  it("retorna texto, modelo, tokens e latência", async () => {
    const result = await runAgent({
      agent: baseAgent,
      messages: [],
      currentMessage,
      apiKey: "sk-test",
      organizationId: "org-1",
    });

    expect(result.text).toBe("Olá! Como posso ajudar?");
    expect(result.model).toBe("gpt-4o-mini");
    expect(result.tokensUsed).toBe(50);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("passa agent.max_steps para generateText", async () => {
    await runAgent({
      agent: { ...baseAgent, max_steps: 7 },
      messages: [],
      currentMessage,
      apiKey: "sk-test",
      organizationId: "org-1",
    });

    const call = vi.mocked(generateText).mock.calls[0][0];
    expect(call.maxSteps).toBe(7);
  });

  it("chama buildToolsForAgent com tools_config correto", async () => {
    await runAgent({
      agent: { ...baseAgent, tools_config: { search_knowledge: true, search_faq: false } },
      messages: [],
      currentMessage,
      apiKey: "sk-test",
      organizationId: "org-1",
    });

    expect(buildToolsForAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        toolsConfig: { search_knowledge: true, search_faq: false },
      })
    );
  });

  it("inclui histórico formatado nas mensagens do LLM", async () => {
    const history = [
      { ...currentMessage, id: "msg-0", role: "agent" as const, content: "Como posso ajudar?" },
    ];

    await runAgent({
      agent: baseAgent,
      messages: history,
      currentMessage,
      apiKey: "sk-test",
      organizationId: "org-1",
    });

    const call = vi.mocked(generateText).mock.calls[0][0];
    const messages = call.messages as Array<{ role: string; content: string }>;
    expect(messages[0]).toEqual({ role: "assistant", content: "Como posso ajudar?" });
    expect(messages[messages.length - 1]).toEqual({ role: "user", content: "Olá" });
  });
});
```

- [ ] **Step 2: Rodar o teste**

```bash
pnpm --filter @aula-agente/worker test
```

Saída esperada:
```
✓ apps/worker/src/agents/__tests__/agent-runner.test.ts (4)
Test Files  2 passed (2)
Tests       9 passed (9)
```

- [ ] **Step 3: Commit**

```bash
git add apps/worker/src/agents/__tests__/agent-runner.test.ts
git commit -m "test: adicionar testes para agent-runner (max_steps, tools, histórico)"
```

---

## Task 9: Teste do process-message (Fix 4)

**Files:**
- Create: `apps/worker/src/workers/__tests__/process-message.test.ts`

- [ ] **Step 1: Criar o arquivo de teste**

Crie `apps/worker/src/workers/__tests__/process-message.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("bullmq", () => ({
  Worker: vi.fn().mockImplementation((_name: string, processor: Function) => ({
    on: vi.fn(),
    _processor: processor,
  })),
}));
vi.mock("@aula-agente/database", () => ({
  getAdminClient: vi.fn(() => ({})),
  getAgentById: vi.fn(),
  getRecentMessages: vi.fn(),
  getConversationById: vi.fn(),
  createMessage: vi.fn(),
  updateConversation: vi.fn(),
  getInstanceById: vi.fn(),
}));
vi.mock("@aula-agente/queue", () => ({
  getSendMessageQueue: vi.fn(() => ({ add: vi.fn() })),
}));
vi.mock("@aula-agente/shared", () => ({
  QUEUE_NAMES: { PROCESS_MESSAGE: "process-message" },
}));
vi.mock("../../lib/redis", () => ({ getConnectionOptions: vi.fn(() => ({})) }));
vi.mock("../../lib/lock", () => ({
  acquireConversationLock: vi.fn(async () => "lock-value"),
  releaseConversationLock: vi.fn(async () => {}),
}));
vi.mock("../../lib/vault", () => ({ resolveApiKey: vi.fn(async () => "sk-test") }));
vi.mock("../../agents/agent-runner", () => ({
  runAgent: vi.fn(async () => ({
    text: "Resposta do agente",
    model: "gpt-4o-mini",
    tokensUsed: 50,
    latencyMs: 100,
    toolCalls: [],
  })),
}));

import {
  getAgentById,
  getConversationById,
  getRecentMessages,
  createMessage,
  updateConversation,
  getInstanceById,
} from "@aula-agente/database";
import { getSendMessageQueue } from "@aula-agente/queue";
import { acquireConversationLock } from "../../lib/lock";
import { startProcessMessageWorker } from "../process-message";

const jobData = {
  conversationId: "conv-1",
  messageId: "msg-1",
  agentId: "agent-1",
  organizationId: "org-1",
};

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
};

const conversation = {
  id: "conv-1",
  is_human_takeover: false,
  evolution_instance_id: "inst-1",
  contacts: { phone: "5511999999999" },
};

const messages = [
  { id: "msg-1", role: "contact", content: "Olá" },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getAgentById).mockResolvedValue(activeAgent as ReturnType<typeof getAgentById> extends Promise<infer R> ? R : never);
  vi.mocked(getConversationById).mockResolvedValue(conversation as ReturnType<typeof getConversationById> extends Promise<infer R> ? R : never);
  vi.mocked(getRecentMessages).mockResolvedValue(messages as ReturnType<typeof getRecentMessages> extends Promise<infer R> ? R : never);
  vi.mocked(createMessage).mockResolvedValue({ id: "msg-resp-1" } as ReturnType<typeof createMessage> extends Promise<infer R> ? R : never);
  vi.mocked(getInstanceById).mockResolvedValue({ id: "inst-1", instance_name: "inst-name" } as ReturnType<typeof getInstanceById> extends Promise<infer R> ? R : never);
});

async function runJob() {
  const { Worker } = await import("bullmq");
  startProcessMessageWorker();
  const workerInstance = vi.mocked(Worker).mock.results[0].value;
  await workerInstance._processor({ data: jobData });
}

describe("startProcessMessageWorker", () => {
  it("não processa se agente estiver inativo", async () => {
    vi.mocked(getAgentById).mockResolvedValue({ ...activeAgent, is_active: false } as ReturnType<typeof getAgentById> extends Promise<infer R> ? R : never);
    await runJob();
    expect(createMessage).not.toHaveBeenCalled();
  });

  it("não processa se conversa estiver em human takeover", async () => {
    vi.mocked(getConversationById).mockResolvedValue({ ...conversation, is_human_takeover: true } as ReturnType<typeof getConversationById> extends Promise<infer R> ? R : never);
    await runJob();
    expect(createMessage).not.toHaveBeenCalled();
  });

  it("caminho feliz: salva resposta e enfileira send-message", async () => {
    const sendQueue = { add: vi.fn() };
    vi.mocked(getSendMessageQueue).mockReturnValue(sendQueue as ReturnType<typeof getSendMessageQueue>);

    await runJob();

    expect(createMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ role: "agent", content: "Resposta do agente" })
    );
    expect(sendQueue.add).toHaveBeenCalledWith(
      "send-message",
      expect.objectContaining({ phone: "5511999999999" })
    );
  });

  it("libera o lock mesmo em caso de erro", async () => {
    vi.mocked(getConversationById).mockRejectedValue(new Error("DB error"));
    const { releaseConversationLock } = await import("../../lib/lock");

    await expect(runJob()).rejects.toThrow("DB error");
    expect(releaseConversationLock).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar o teste**

```bash
pnpm --filter @aula-agente/worker test
```

Saída esperada:
```
✓ apps/worker/src/workers/__tests__/process-message.test.ts (4)
Test Files  3 passed (3)
Tests  13 passed (13)
```

- [ ] **Step 3: Commit**

```bash
git add apps/worker/src/workers/__tests__/process-message.test.ts
git commit -m "test: adicionar testes para process-message worker"
```

---

## Task 10: Teste do process-document + resolveEmbeddingApiKey (Fix 4)

**Files:**
- Create: `apps/worker/src/workers/__tests__/process-document.test.ts`

- [ ] **Step 1: Criar o arquivo de teste**

Crie `apps/worker/src/workers/__tests__/process-document.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("bullmq", () => ({
  Worker: vi.fn().mockImplementation((_name: string, processor: Function) => ({
    on: vi.fn(),
    _processor: processor,
  })),
}));
vi.mock("@aula-agente/database", () => ({
  getAdminClient: vi.fn(() => ({})),
  getDocumentById: vi.fn(),
  updateDocument: vi.fn(),
  insertChunks: vi.fn(),
}));
vi.mock("@aula-agente/shared", () => ({
  QUEUE_NAMES: { PROCESS_DOCUMENT: "process-document" },
}));
vi.mock("../../lib/redis", () => ({ getConnectionOptions: vi.fn(() => ({})) }));
vi.mock("../../lib/vault", () => ({ resolveEmbeddingApiKey: vi.fn(async () => "sk-embed") }));
vi.mock("../../embeddings/embedder", () => ({
  generateEmbeddings: vi.fn(async (texts: string[]) => texts.map(() => new Array(1536).fill(0))),
}));
vi.mock("pdf-parse", () => ({ default: vi.fn() }));
vi.mock("mammoth", () => ({ extractRawText: vi.fn() }));

import { getDocumentById, updateDocument, insertChunks } from "@aula-agente/database";
import { resolveEmbeddingApiKey } from "../../lib/vault";
import { startProcessDocumentWorker } from "../process-document";

const jobData = { documentId: "doc-1", organizationId: "org-1", agentId: "agent-1" };

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = vi.fn();
});

async function runJob() {
  const { Worker } = await import("bullmq");
  startProcessDocumentWorker();
  const workerInstance = vi.mocked(Worker).mock.results[0].value;
  await workerInstance._processor({ data: jobData });
}

describe("startProcessDocumentWorker", () => {
  it("atualiza status para error se o texto extraído for vazio", async () => {
    vi.mocked(getDocumentById).mockResolvedValue({
      id: "doc-1",
      file_url: "http://example.com/doc.txt",
      file_type: "txt",
    } as ReturnType<typeof getDocumentById> extends Promise<infer R> ? R : never);

    vi.mocked(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      text: async () => "   ",
    });

    await runJob();

    expect(updateDocument).toHaveBeenCalledWith(
      expect.anything(),
      "doc-1",
      expect.objectContaining({ status: "error" })
    );
    expect(insertChunks).not.toHaveBeenCalled();
  });

  it("usa resolveEmbeddingApiKey passando o organizationId correto", async () => {
    vi.mocked(getDocumentById).mockResolvedValue({
      id: "doc-1",
      file_url: "http://example.com/doc.txt",
      file_type: "txt",
    } as ReturnType<typeof getDocumentById> extends Promise<infer R> ? R : never);

    vi.mocked(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      text: async () => "Conteúdo válido do documento",
    });

    await runJob();

    expect(resolveEmbeddingApiKey).toHaveBeenCalledWith("org-1");
  });

  it("caminho feliz: insere chunks e atualiza status para ready", async () => {
    vi.mocked(getDocumentById).mockResolvedValue({
      id: "doc-1",
      file_url: "http://example.com/doc.txt",
      file_type: "txt",
    } as ReturnType<typeof getDocumentById> extends Promise<infer R> ? R : never);

    vi.mocked(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      text: async () => "Conteúdo válido do documento para processamento",
    });

    await runJob();

    expect(insertChunks).toHaveBeenCalled();
    expect(updateDocument).toHaveBeenCalledWith(
      expect.anything(),
      "doc-1",
      expect.objectContaining({ status: "ready" })
    );
  });
});
```

- [ ] **Step 2: Rodar o teste**

```bash
pnpm --filter @aula-agente/worker test
```

Saída esperada:
```
✓ apps/worker/src/workers/__tests__/process-document.test.ts (5)
Test Files  4 passed (4)
Tests  18 passed (18)
```

- [ ] **Step 3: Commit**

```bash
git add apps/worker/src/workers/__tests__/process-document.test.ts
git commit -m "test: adicionar testes para process-document e resolveEmbeddingApiKey"
```

---

## Task 11: Teste do webhook Evolution (Fix 4)

**Files:**
- Create: `apps/api/src/routes/webhooks/__tests__/evolution.test.ts`

- [ ] **Step 1: Criar o arquivo de teste**

Crie `apps/api/src/routes/webhooks/__tests__/evolution.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";

vi.mock("@aula-agente/database", () => ({
  getAdminClient: vi.fn(() => ({})),
  getInstanceByInstanceId: vi.fn(),
}));
vi.mock("../../../services/conversation.service", () => ({
  ensureConversation: vi.fn(),
}));
vi.mock("../../../services/message.service", () => ({
  saveMessage: vi.fn(),
}));
vi.mock("../../../lib/queue", () => ({
  enqueueProcessMessage: vi.fn(),
}));
vi.mock("../../../middleware/webhook-verify", () => ({
  webhookVerifyMiddleware: vi.fn(async () => {}), // bypass verification
}));

import { getInstanceByInstanceId } from "@aula-agente/database";
import { ensureConversation } from "../../../services/conversation.service";
import { saveMessage } from "../../../services/message.service";
import { enqueueProcessMessage } from "../../../lib/queue";
import evolutionWebhookRoutes from "../evolution";

const validPayload = {
  instance: "inst-abc",
  data: {
    key: { fromMe: false, id: "evo-msg-1", remoteJid: "5511999999999@s.whatsapp.net" },
    pushName: "João",
    messageType: "conversation",
    message: { conversation: "Olá!" },
  },
};

const activeInstance = {
  id: "inst-db-1",
  organization_id: "org-1",
  active_agent_id: "agent-1",
  instance_name: "inst-abc",
};

async function buildApp() {
  const app = Fastify();
  await app.register(evolutionWebhookRoutes);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /webhooks/evolution", () => {
  it("retorna 200 skipped quando fromMe=true", async () => {
    const app = await buildApp();
    const payload = { ...validPayload, data: { ...validPayload.data, key: { ...validPayload.data.key, fromMe: true } } };

    const res = await app.inject({ method: "POST", url: "/webhooks/evolution", payload });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).skipped).toBe("fromMe");
  });

  it("retorna 200 skipped quando instância não existe (PGRST116)", async () => {
    vi.mocked(getInstanceByInstanceId).mockRejectedValue({ code: "PGRST116" });
    const app = await buildApp();

    const res = await app.inject({ method: "POST", url: "/webhooks/evolution", payload: validPayload });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).skipped).toBe("unknown_instance");
  });

  it("retorna 200 skipped quando instância não tem agente ativo", async () => {
    vi.mocked(getInstanceByInstanceId).mockResolvedValue({ ...activeInstance, active_agent_id: null } as ReturnType<typeof getInstanceByInstanceId> extends Promise<infer R> ? R : never);
    const app = await buildApp();

    const res = await app.inject({ method: "POST", url: "/webhooks/evolution", payload: validPayload });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).skipped).toBe("no_agent");
  });

  it("retorna 200 skipped quando human takeover está ativo", async () => {
    vi.mocked(getInstanceByInstanceId).mockResolvedValue(activeInstance as ReturnType<typeof getInstanceByInstanceId> extends Promise<infer R> ? R : never);
    vi.mocked(ensureConversation).mockResolvedValue({ conversation: { id: "conv-1", is_human_takeover: true } } as ReturnType<typeof ensureConversation> extends Promise<infer R> ? R : never);
    vi.mocked(saveMessage).mockResolvedValue({ id: "msg-1" } as ReturnType<typeof saveMessage> extends Promise<infer R> ? R : never);
    const app = await buildApp();

    const res = await app.inject({ method: "POST", url: "/webhooks/evolution", payload: validPayload });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).skipped).toBe("human_takeover");
    expect(enqueueProcessMessage).not.toHaveBeenCalled();
  });

  it("caminho feliz: 200 com messageId e job enfileirado", async () => {
    vi.mocked(getInstanceByInstanceId).mockResolvedValue(activeInstance as ReturnType<typeof getInstanceByInstanceId> extends Promise<infer R> ? R : never);
    vi.mocked(ensureConversation).mockResolvedValue({ conversation: { id: "conv-1", is_human_takeover: false } } as ReturnType<typeof ensureConversation> extends Promise<infer R> ? R : never);
    vi.mocked(saveMessage).mockResolvedValue({ id: "msg-saved-1" } as ReturnType<typeof saveMessage> extends Promise<infer R> ? R : never);
    const app = await buildApp();

    const res = await app.inject({ method: "POST", url: "/webhooks/evolution", payload: validPayload });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(true);
    expect(body.messageId).toBe("msg-saved-1");
    expect(enqueueProcessMessage).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: "conv-1", agentId: "agent-1" })
    );
  });
});
```

- [ ] **Step 2: Rodar os testes da API**

```bash
pnpm --filter @aula-agente/api test
```

Saída esperada:
```
✓ apps/api/src/routes/webhooks/__tests__/evolution.test.ts (5)
Test Files  1 passed (1)
Tests  5 passed (5)
```

- [ ] **Step 3: Rodar todos os testes para garantir que nada quebrou**

```bash
pnpm test
```

Saída esperada: todos os pacotes com testes passando, zero falhas.

- [ ] **Step 4: Commit final**

```bash
git add apps/api/src/routes/webhooks/__tests__/evolution.test.ts
git commit -m "test: adicionar testes de integração para webhook Evolution"
```

---

## Task 12: Teste dos schemas do shared (Fix 4)

**Files:**
- Create: `packages/shared/src/__tests__/schemas.test.ts`

- [ ] **Step 1: Criar o arquivo de teste**

Crie `packages/shared/src/__tests__/schemas.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createAgentSchema } from "../schemas/agent";

describe("createAgentSchema", () => {
  const valid = {
    name: "Agente Teste",
    system_prompt: "Você é um assistente.",
    model: "gpt-4o-mini",
    provider: "openai" as const,
  };

  it("aceita payload válido com defaults", () => {
    const result = createAgentSchema.safeParse(valid);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.max_steps).toBe(5);
      expect(result.data.temperature).toBe(0.7);
      expect(result.data.max_tokens).toBe(1024);
    }
  });

  it("aceita max_steps dentro do range (1–20)", () => {
    expect(createAgentSchema.safeParse({ ...valid, max_steps: 1 }).success).toBe(true);
    expect(createAgentSchema.safeParse({ ...valid, max_steps: 20 }).success).toBe(true);
  });

  it("rejeita max_steps fora do range", () => {
    expect(createAgentSchema.safeParse({ ...valid, max_steps: 0 }).success).toBe(false);
    expect(createAgentSchema.safeParse({ ...valid, max_steps: 21 }).success).toBe(false);
  });

  it("rejeita provider inválido", () => {
    const result = createAgentSchema.safeParse({ ...valid, provider: "mistral" });
    expect(result.success).toBe(false);
  });

  it("rejeita name vazio", () => {
    const result = createAgentSchema.safeParse({ ...valid, name: "" });
    expect(result.success).toBe(false);
  });

  it("rejeita system_prompt vazio", () => {
    const result = createAgentSchema.safeParse({ ...valid, system_prompt: "" });
    expect(result.success).toBe(false);
  });

  it("rejeita temperature fora do range (0–2)", () => {
    expect(createAgentSchema.safeParse({ ...valid, temperature: -0.1 }).success).toBe(false);
    expect(createAgentSchema.safeParse({ ...valid, temperature: 2.1 }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar os testes do shared**

```bash
pnpm --filter @aula-agente/shared test
```

Saída esperada:
```
✓ packages/shared/src/__tests__/schemas.test.ts (7)
Test Files  1 passed (1)
Tests  7 passed (7)
```

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/__tests__/schemas.test.ts
git commit -m "test: adicionar testes para createAgentSchema incluindo max_steps"
```

---

## Verificação final

Após todos os tasks, rodar:

```bash
pnpm typecheck && pnpm test
```

Critérios de sucesso:
- [ ] `pnpm typecheck` — zero erros em todos os pacotes
- [ ] `pnpm test` — todos os testes passando
- [ ] Agente com `max_steps: 3` executa no máximo 3 iterações no agent-runner
- [ ] Org sem chave OpenAI processa documentos via `PLATFORM_OPENAI_EMBEDDING_KEY`
- [ ] Inbox não dispara `fetchConversations` em eventos `onUpdate`
- [ ] 4 caminhos críticos cobertos: webhook, process-message, process-document, agent-runner
