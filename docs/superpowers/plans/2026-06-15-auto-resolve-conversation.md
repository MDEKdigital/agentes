# Auto-Resolução de Conversa — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que o agente IA detecte automaticamente o encerramento de uma conversa, marque como `"resolved"` via tool call, e reabra a conversa quando o cliente retornar.

**Architecture:** Nova tool `close_conversation` registrada globalmente em todos os agentes. Um bloco de instrução fixo é injetado no `system_prompt` em `runAgent` via `effectiveBasePrompt`. O `process-message` verifica `result.toolCalls` para decidir o status final da conversa. `findOpenConversation` inclui `"resolved"` na busca; `ensureConversation` reativa conversas resolvidas em vez de criar novas.

**Tech Stack:** TypeScript, Vitest, Vercel AI SDK (`tool` from `"ai"`, `z` from `"zod"`), Supabase via `@aula-agente/database`, BullMQ

---

## File Map

| Arquivo | Ação |
|---|---|
| `apps/worker/src/agents/tools/close-conversation.ts` | Criar |
| `apps/worker/src/agents/tools/__tests__/close-conversation.test.ts` | Criar |
| `apps/worker/src/agents/tools/registry.ts` | Modificar |
| `apps/worker/src/agents/agent-runner.ts` | Modificar |
| `apps/worker/src/agents/__tests__/agent-runner.test.ts` | Modificar |
| `apps/worker/src/workers/process-message.ts` | Modificar |
| `apps/worker/src/workers/__tests__/process-message.test.ts` | Modificar |
| `packages/database/src/queries/conversations.ts` | Modificar |
| `apps/api/src/services/conversation.service.ts` | Modificar |
| `apps/api/src/services/__tests__/conversation.service.test.ts` | Criar |

---

## Task 1: Tool `close_conversation`

**Files:**
- Create: `apps/worker/src/agents/tools/close-conversation.ts`
- Create: `apps/worker/src/agents/tools/__tests__/close-conversation.test.ts`

- [ ] **Step 1.1: Criar pasta de testes se não existir e escrever o teste com falha**

```typescript
// apps/worker/src/agents/tools/__tests__/close-conversation.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockUpdateConversation = vi.fn();

vi.mock("@aula-agente/database", () => ({
  getAdminClient: vi.fn(() => ({})),
  updateConversation: mockUpdateConversation,
}));

import { buildCloseConversationTool } from "../close-conversation";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("buildCloseConversationTool", () => {
  it("chama updateConversation com status resolved ao executar", async () => {
    mockUpdateConversation.mockResolvedValue({ id: "conv-1", status: "resolved" });
    const tool = buildCloseConversationTool("conv-1");
    const result = await tool.execute({}, { messages: [], toolCallId: "tc-1" });
    expect(mockUpdateConversation).toHaveBeenCalledWith(
      expect.anything(),
      "conv-1",
      { status: "resolved" }
    );
    expect(result).toEqual({ success: true });
  });

  it("usa o conversationId passado via closure, não hardcoded", async () => {
    mockUpdateConversation.mockResolvedValue({ id: "conv-abc", status: "resolved" });
    const tool = buildCloseConversationTool("conv-abc");
    await tool.execute({}, { messages: [], toolCallId: "tc-2" });
    expect(mockUpdateConversation).toHaveBeenCalledWith(
      expect.anything(),
      "conv-abc",
      { status: "resolved" }
    );
  });
});
```

- [ ] **Step 1.2: Rodar o teste para confirmar falha**

```
cd apps/worker && pnpm test -- close-conversation
```

Esperado: FAIL com "Cannot find module '../close-conversation'"

- [ ] **Step 1.3: Implementar a tool**

```typescript
// apps/worker/src/agents/tools/close-conversation.ts
import { tool } from "ai";
import { z } from "zod";
import { getAdminClient, updateConversation } from "@aula-agente/database";

export function buildCloseConversationTool(conversationId: string) {
  return tool({
    description:
      "Marca a conversa como resolvida e encerra o atendimento. " +
      "Use somente quando o cliente confirmar explicitamente que não precisa de mais ajuda.",
    parameters: z.object({}),
    execute: async () => {
      const db = getAdminClient();
      await updateConversation(db, conversationId, { status: "resolved" });
      return { success: true };
    },
  });
}
```

- [ ] **Step 1.4: Rodar os testes para confirmar que passam**

```
cd apps/worker && pnpm test -- close-conversation
```

Esperado: PASS (2 testes)

- [ ] **Step 1.5: Commit**

```bash
git add apps/worker/src/agents/tools/close-conversation.ts apps/worker/src/agents/tools/__tests__/close-conversation.test.ts
git commit -m "feat: tool close_conversation para marcar conversa como resolved"
```

---

## Task 2: Registry e agent-runner — adicionar `conversationId`

**Files:**
- Modify: `apps/worker/src/agents/tools/registry.ts`
- Modify: `apps/worker/src/agents/agent-runner.ts`
- Modify: `apps/worker/src/agents/__tests__/agent-runner.test.ts`

- [ ] **Step 2.1: Escrever testes com falha para as novas responsabilidades do agent-runner**

Adicionar estes testes no final do arquivo `apps/worker/src/agents/__tests__/agent-runner.test.ts` (dentro do `describe("runAgent")` já existente):

```typescript
  it("passa conversationId para buildToolsForAgent", async () => {
    await runAgent({
      agent: baseAgent,
      messages: [],
      currentMessage,
      apiKey: "sk-test",
      organizationId: "org-1",
      conversationId: "conv-xyz",
    });

    expect(mockBuildToolsForAgent).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: "conv-xyz" })
    );
  });

  it("inclui instrução REGRA DE ENCERRAMENTO no system prompt enviado ao LLM", async () => {
    await runAgent({
      agent: baseAgent,
      messages: [],
      currentMessage,
      apiKey: "sk-test",
      organizationId: "org-1",
      conversationId: "conv-1",
    });

    const call = vi.mocked(generateText).mock.calls[0][0];
    expect((call as { system: string }).system).toContain("REGRA DE ENCERRAMENTO");
  });

  it("mantém instrução de encerramento no system prompt da retentativa após violation", async () => {
    vi.mocked(generateText)
      .mockResolvedValueOnce({ text: "Ruim", usage: { totalTokens: 50, promptTokens: 30, completionTokens: 20 }, steps: [] } as never)
      .mockResolvedValueOnce({ text: '{"compliant": false, "violation": "erro"}', usage: { totalTokens: 10, promptTokens: 8, completionTokens: 2 }, steps: [] } as never)
      .mockResolvedValueOnce({ text: "Bom", usage: { totalTokens: 50, promptTokens: 30, completionTokens: 20 }, steps: [] } as never)
      .mockResolvedValueOnce({ text: '{"compliant": true}', usage: { totalTokens: 10, promptTokens: 8, completionTokens: 2 }, steps: [] } as never);

    await runAgent({
      agent: baseAgent,
      messages: [],
      currentMessage,
      apiKey: "sk-test",
      organizationId: "org-1",
      conversationId: "conv-1",
    });

    // 3ª chamada = retentativa — system prompt deve ainda conter a instrução de encerramento
    const retryCall = vi.mocked(generateText).mock.calls[2][0];
    expect((retryCall as { system: string }).system).toContain("REGRA DE ENCERRAMENTO");
  });
```

- [ ] **Step 2.2: Atualizar TODOS os call sites existentes de `runAgent` nos testes para incluir `conversationId: "conv-1"`**

No arquivo `apps/worker/src/agents/__tests__/agent-runner.test.ts`, cada `runAgent({ ... })` existente deve receber `conversationId: "conv-1"`. São as seguintes chamadas (adicione o campo em cada uma):

- linha 69: `runAgent({ agent: baseAgent, messages: [], currentMessage, apiKey: "sk-test", organizationId: "org-1" })`
- linha 85: `runAgent({ agent: { ...baseAgent, max_steps: 7 }, ... })`
- linha 97: `runAgent({ agent: { ...baseAgent, tools_config: ... }, ... })`
- linha 117: `runAgent({ agent: baseAgent, messages: history, ... })`
- linha 145: `runAgent({ agent: baseAgent, messages: [], ... })`
- linha 180: `runAgent({ agent: baseAgent, messages: [], ... })`
- linha 205: `runAgent({ agent: baseAgent, messages: [], ... })`
- linha 223: `runAgent({ agent: baseAgent, messages: [], ... })`
- linha 248: `runAgent({ agent: baseAgent, messages: [], ... })`
- linha 271: `runAgent({ agent: { ...baseAgent, model: "gpt-4o", ... }, ... })` (seção multimodal)
- linha 297: `runAgent({ agent: { ...baseAgent, model: "gpt-4.1-nano", ... }, ... })`
- linha 309: `runAgent({ agent: { ...baseAgent, model: "gpt-4o", ... }, ... })`

Adicione `conversationId: "conv-1"` em cada um.

- [ ] **Step 2.3: Rodar testes para confirmar falha das 3 novas assertivas**

```
cd apps/worker && pnpm test -- agent-runner
```

Esperado: os 3 novos testes falham, os existentes passam (se não passarem, TypeScript está rejeitando — é esperado antes do Step 2.4)

- [ ] **Step 2.4: Atualizar `registry.ts`**

```typescript
// apps/worker/src/agents/tools/registry.ts
import type { ToolsConfig } from "@aula-agente/shared";
import { createSearchKnowledgeTool } from "./search-knowledge";
import { createSearchFaqTool } from "./search-faq";
import { buildCloseConversationTool } from "./close-conversation";

interface RegistryParams {
  organizationId: string;
  agentId: string;
  toolsConfig: ToolsConfig;
  apiKey: string;
  conversationId: string;
}

export function buildToolsForAgent(params: RegistryParams) {
  const { organizationId, agentId, toolsConfig, apiKey, conversationId } = params;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tools: Record<string, any> = {};

  if (toolsConfig.search_knowledge) {
    tools.searchKnowledge = createSearchKnowledgeTool(organizationId, agentId, apiKey);
  }

  if (toolsConfig.search_faq) {
    tools.searchFaq = createSearchFaqTool(agentId, organizationId);
  }

  tools.close_conversation = buildCloseConversationTool(conversationId);

  return tools;
}
```

- [ ] **Step 2.5: Atualizar `agent-runner.ts`**

Em `RunAgentParams`, adicionar:
```typescript
conversationId: string;
```

No corpo de `runAgent`, substituir:
```typescript
let systemPrompt = agent.system_prompt;
```
por:
```typescript
const CLOSE_CONVERSATION_INSTRUCTION = `[REGRA DE ENCERRAMENTO — SEMPRE ATIVA]
Quando o cliente demonstrar que não precisa de mais ajuda (ex: "obrigado", "valeu", "era só isso", "tudo certo", "resolveu", "já comprei", "pode encerrar", "não tenho mais dúvidas"), responda de forma natural e pergunte: "Posso ajudar em mais alguma coisa, ou posso finalizar seu atendimento?"
Se o cliente confirmar o encerramento, envie uma mensagem de despedida natural E chame a ferramenta close_conversation.
Se o cliente ainda tiver dúvidas, continue o atendimento normalmente sem chamar close_conversation.
Quando uma conversa for reaberta (o histórico mostra mensagens anteriores encerradas), não repita a saudação inicial — retome diretamente.`.trim();

const effectiveBasePrompt = `${agent.system_prompt}\n\n${CLOSE_CONVERSATION_INSTRUCTION}`;
let systemPrompt = effectiveBasePrompt;
```

Na chamada de `buildToolsForAgent`, adicionar `conversationId`:
```typescript
const tools = buildToolsForAgent({
  organizationId,
  agentId: agent.id,
  toolsConfig: agent.tools_config,
  apiKey,
  conversationId,
});
```

Na linha de reconstrução do prompt após violation (dentro do loop), substituir `agent.system_prompt` por `effectiveBasePrompt`:
```typescript
systemPrompt = `${effectiveBasePrompt}\n\n[ATENCAO: sua resposta anterior violou uma regra do sistema. Detalhe: ${sanitizedViolation}. Corrija na proxima resposta.]`;
```

Na chamada de `validateResponse`, substituir `systemPrompt: agent.system_prompt` por `systemPrompt: effectiveBasePrompt`:
```typescript
const validation = await validateResponse({
  systemPrompt: effectiveBasePrompt,
  response: result.text,
  provider: agent.provider,
  apiKey,
});
```

- [ ] **Step 2.6: Rodar todos os testes do worker**

```
cd apps/worker && pnpm test
```

Esperado: PASS em todos os testes (incluindo os 3 novos)

- [ ] **Step 2.7: Commit**

```bash
git add apps/worker/src/agents/tools/registry.ts apps/worker/src/agents/agent-runner.ts apps/worker/src/agents/__tests__/agent-runner.test.ts
git commit -m "feat: injetar instrução global de encerramento e conversationId no agent-runner"
```

---

## Task 3: `process-message` — conversationId e status condicional

**Files:**
- Modify: `apps/worker/src/workers/process-message.ts`
- Modify: `apps/worker/src/workers/__tests__/process-message.test.ts`

- [ ] **Step 3.1: Escrever testes com falha**

Adicionar no final do arquivo `apps/worker/src/workers/__tests__/process-message.test.ts` (dentro do `describe("startProcessMessageWorker")`):

```typescript
  it("passa conversationId para runAgent", async () => {
    await runJob();
    expect(mockRunAgent).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: "conv-1" })
    );
  });

  it("seta status 'waiting' quando agente não chamou close_conversation", async () => {
    mockRunAgent.mockResolvedValue({
      text: "Resposta",
      model: "gpt-4o-mini",
      tokensUsed: 50,
      latencyMs: 100,
      toolCalls: [],
    });

    await runJob();

    expect(updateConversation).toHaveBeenCalledWith(
      expect.anything(),
      "conv-1",
      expect.objectContaining({ status: "waiting" })
    );
  });

  it("seta status 'resolved' quando agente chamou close_conversation", async () => {
    mockRunAgent.mockResolvedValue({
      text: "Até logo!",
      model: "gpt-4o-mini",
      tokensUsed: 50,
      latencyMs: 100,
      toolCalls: ["close_conversation"],
    });

    await runJob();

    expect(updateConversation).toHaveBeenCalledWith(
      expect.anything(),
      "conv-1",
      expect.objectContaining({ status: "resolved" })
    );
  });
```

- [ ] **Step 3.2: Rodar para confirmar falha dos 3 novos testes**

```
cd apps/worker && pnpm test -- process-message
```

Esperado: os 3 novos testes falham

- [ ] **Step 3.3: Atualizar `process-message.ts`**

Na chamada de `runAgent` (linha ~257), adicionar `conversationId`:
```typescript
const result = await runAgent({
  agent,
  messages: history,
  currentMessage: effectiveMessage,
  apiKey,
  organizationId,
  imageContent,
  conversationId,
});
```

No `updateConversation` final (linha ~282), tornar o status condicional:
```typescript
const wasResolved = result.toolCalls.includes("close_conversation");
await updateConversation(db, conversationId, {
  last_message_at: new Date().toISOString(),
  status: wasResolved ? "resolved" : "waiting",
});
```

- [ ] **Step 3.4: Rodar todos os testes do worker**

```
cd apps/worker && pnpm test
```

Esperado: PASS em todos os testes

- [ ] **Step 3.5: Commit**

```bash
git add apps/worker/src/workers/process-message.ts apps/worker/src/workers/__tests__/process-message.test.ts
git commit -m "feat: process-message resolve conversa quando close_conversation é chamada"
```

---

## Task 4: `findOpenConversation` e `ensureConversation` — reabertura de conversa resolvida

**Files:**
- Modify: `packages/database/src/queries/conversations.ts`
- Modify: `apps/api/src/services/conversation.service.ts`
- Create: `apps/api/src/services/__tests__/conversation.service.test.ts`

- [ ] **Step 4.1: Criar arquivo de teste com falha**

```typescript
// apps/api/src/services/__tests__/conversation.service.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockFindOpenConversation,
  mockUpdateConversation,
  mockCreateConversation,
  mockUpsertContact,
} = vi.hoisted(() => ({
  mockFindOpenConversation: vi.fn(),
  mockUpdateConversation: vi.fn(),
  mockCreateConversation: vi.fn(),
  mockUpsertContact: vi.fn(),
}));

vi.mock("@aula-agente/database", () => ({
  getAdminClient: vi.fn(() => ({})),
  findOpenConversation: mockFindOpenConversation,
  updateConversation: mockUpdateConversation,
  createConversation: mockCreateConversation,
  upsertContact: mockUpsertContact,
}));

import { ensureConversation } from "../conversation.service";

const baseParams = {
  organizationId: "org-1",
  agentId: "agent-1",
  instanceId: "inst-1",
  phone: "5511999999999",
  contactName: "João",
  contactPhotoUrl: null,
};

const contact = { id: "contact-1", phone: "5511999999999" };

beforeEach(() => {
  vi.clearAllMocks();
  mockUpsertContact.mockResolvedValue(contact);
});

describe("ensureConversation", () => {
  it("retorna conversa 'open' existente sem modificar", async () => {
    const openConv = { id: "conv-1", status: "open" };
    mockFindOpenConversation.mockResolvedValue(openConv);

    const result = await ensureConversation(baseParams);

    expect(result.conversation).toEqual(openConv);
    expect(result.isNew).toBe(false);
    expect(mockUpdateConversation).not.toHaveBeenCalled();
    expect(mockCreateConversation).not.toHaveBeenCalled();
  });

  it("retorna conversa 'waiting' existente sem modificar", async () => {
    const waitingConv = { id: "conv-1", status: "waiting" };
    mockFindOpenConversation.mockResolvedValue(waitingConv);

    const result = await ensureConversation(baseParams);

    expect(result.conversation).toEqual(waitingConv);
    expect(mockUpdateConversation).not.toHaveBeenCalled();
  });

  it("reativa conversa 'resolved' para 'open' em vez de criar nova", async () => {
    const resolvedConv = { id: "conv-resolved", status: "resolved" };
    const reopenedConv = { id: "conv-resolved", status: "open" };
    mockFindOpenConversation.mockResolvedValue(resolvedConv);
    mockUpdateConversation.mockResolvedValue(reopenedConv);

    const result = await ensureConversation(baseParams);

    expect(mockUpdateConversation).toHaveBeenCalledWith(
      expect.anything(),
      "conv-resolved",
      { status: "open" }
    );
    expect(result.conversation).toEqual(reopenedConv);
    expect(result.isNew).toBe(false);
    expect(mockCreateConversation).not.toHaveBeenCalled();
  });

  it("cria nova conversa quando não existe nenhuma", async () => {
    mockFindOpenConversation.mockResolvedValue(null);
    const newConv = { id: "conv-new", status: "open" };
    mockCreateConversation.mockResolvedValue(newConv);

    const result = await ensureConversation(baseParams);

    expect(mockCreateConversation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organization_id: "org-1",
        agent_id: "agent-1",
        status: "open",
      })
    );
    expect(result.isNew).toBe(true);
  });
});
```

- [ ] **Step 4.2: Rodar testes para confirmar falha**

```
cd apps/api && pnpm test -- conversation.service
```

Esperado: FAIL — o teste de reativação de conversa resolved falha pois `ensureConversation` não tem esse branch ainda

- [ ] **Step 4.3: Atualizar `findOpenConversation` em `packages/database/src/queries/conversations.ts`**

Alterar o filtro de status de:
```typescript
.in("status", ["open", "waiting"])
```
para:
```typescript
.in("status", ["open", "waiting", "resolved"])
```

- [ ] **Step 4.4: Atualizar `ensureConversation` em `apps/api/src/services/conversation.service.ts`**

Substituir o bloco `if (existing)`:

```typescript
if (existing) {
  if (existing.status === "resolved") {
    const reopened = await updateConversation(db, existing.id, { status: "open" });
    return { conversation: reopened, contact, isNew: false };
  }
  return { conversation: existing, contact, isNew: false };
}
```

Garantir que `updateConversation` está importado no topo do arquivo (já deve estar via `@aula-agente/database`).

- [ ] **Step 4.5: Rodar todos os testes da API**

```
cd apps/api && pnpm test
```

Esperado: PASS em todos os testes

- [ ] **Step 4.6: Rodar todos os testes do worker também para garantir que nada quebrou**

```
cd apps/worker && pnpm test
```

Esperado: PASS

- [ ] **Step 4.7: Commit**

```bash
git add packages/database/src/queries/conversations.ts apps/api/src/services/conversation.service.ts apps/api/src/services/__tests__/conversation.service.test.ts
git commit -m "feat: reabrir conversa resolved em vez de criar nova ao receber nova mensagem"
```

---

## Task 5: Verificação integrada

- [ ] **Step 5.1: Rodar todos os testes de todos os pacotes**

```
pnpm --filter @aula-agente/worker test
pnpm --filter @aula-agente/api test
```

Esperado: PASS em todos os testes de ambos os pacotes

- [ ] **Step 5.2: Verificar TypeScript sem erros**

```
cd apps/worker && pnpm exec tsc --noEmit
cd apps/api && pnpm exec tsc --noEmit
cd packages/database && pnpm exec tsc --noEmit
```

Esperado: sem erros de compilação em nenhum dos três pacotes

- [ ] **Step 5.3: Commit final**

```bash
git add -A
git commit -m "chore: verificação integrada — auto-resolução de conversa completa"
```
