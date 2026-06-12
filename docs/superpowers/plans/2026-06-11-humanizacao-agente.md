# Humanização do Agente — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tornar o agente mais humano adicionando (1) indicador de digitação + delay aleatório antes de enviar respostas, e (2) validação pós-resposta com guardrail LLM para garantir que o agente segue as regras do system prompt.

**Architecture:** Task 1 modifica `send-message.ts` para enviar presença "composing" e aguardar 3–8s antes de enviar. Task 2 modifica `agent-runner.ts` para validar a resposta gerada com um modelo barato e retentar até 2x se violar regras do system prompt.

**Tech Stack:** BullMQ, Evolution API REST, Vercel AI SDK (`generateText`), Vitest

---

### Task 1: Indicador de digitação + delay no send-message worker

**Files:**
- Modify: `apps/worker/src/workers/send-message.ts`
- Create: `apps/worker/src/workers/__tests__/send-message.test.ts`

- [ ] **Step 1: Escrever testes que falham**

Criar `apps/worker/src/workers/__tests__/send-message.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

vi.mock("bullmq", () => ({
  Worker: vi.fn().mockImplementation((_name: string, processor: Function) => ({
    on: vi.fn(),
    _processor: processor,
  })),
}));
vi.mock("@aula-agente/database", () => ({
  getAdminClient: vi.fn(() => ({})),
  getInstanceById: vi.fn(),
}));
vi.mock("@aula-agente/shared", () => ({
  QUEUE_NAMES: { SEND_MESSAGE: "send-message" },
}));
vi.mock("../../lib/redis", () => ({ getConnectionOptions: vi.fn(() => ({})) }));

import { getInstanceById } from "@aula-agente/database";
import { startSendMessageWorker } from "../send-message";

const jobData = {
  conversationId: "conv-1",
  messageId: "msg-1",
  instanceId: "inst-1",
  phone: "5511999999999",
  content: "Olá! Posso ajudar?",
  organizationId: "org-1",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.mocked(getInstanceById).mockResolvedValue({
    id: "inst-1",
    instance_name: "minha-instancia",
  } as never);
  mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) } as never);
  process.env.EVOLUTION_API_URL = "http://evolution:8080";
  process.env.EVOLUTION_API_KEY = "test-key";
});

afterEach(() => {
  vi.useRealTimers();
});

async function runJob() {
  const { Worker } = await import("bullmq");
  startSendMessageWorker();
  const workerInstance = vi.mocked(Worker).mock.results[0].value;
  const jobPromise = workerInstance._processor({ data: jobData });
  await vi.runAllTimersAsync();
  return jobPromise;
}

describe("startSendMessageWorker", () => {
  it("envia sendPresence composing antes de enviar mensagem", async () => {
    await runJob();

    const calls = mockFetch.mock.calls;
    const presenceCall = calls.find((c) =>
      (c[0] as string).includes("/chat/sendPresence/")
    );
    expect(presenceCall).toBeDefined();
    const presenceBody = JSON.parse(presenceCall![1].body as string);
    expect(presenceBody.options.presence).toBe("composing");
  });

  it("envia sendPresence paused depois de enviar mensagem", async () => {
    await runJob();

    const calls = mockFetch.mock.calls;
    const presenceCalls = calls.filter((c) =>
      (c[0] as string).includes("/chat/sendPresence/")
    );
    expect(presenceCalls.length).toBe(2);
    const lastPresenceBody = JSON.parse(presenceCalls[1][1].body as string);
    expect(lastPresenceBody.options.presence).toBe("paused");
  });

  it("sendPresence composing ocorre antes de sendText", async () => {
    await runJob();

    const calls = mockFetch.mock.calls;
    const presenceIdx = calls.findIndex((c) =>
      (c[0] as string).includes("/chat/sendPresence/")
    );
    const sendTextIdx = calls.findIndex((c) =>
      (c[0] as string).includes("/message/sendText/")
    );
    expect(presenceIdx).toBeLessThan(sendTextIdx);
  });

  it("envia a mensagem mesmo se sendPresence falhar", async () => {
    mockFetch
      .mockRejectedValueOnce(new Error("presence failed"))
      .mockResolvedValue({ ok: true, json: async () => ({}) } as never);

    await runJob();

    const sendTextCall = mockFetch.mock.calls.find((c) =>
      (c[0] as string).includes("/message/sendText/")
    );
    expect(sendTextCall).toBeDefined();
  });

  it("caminho feliz: envia mensagem com número e texto corretos", async () => {
    await runJob();

    const sendTextCall = mockFetch.mock.calls.find((c) =>
      (c[0] as string).includes("/message/sendText/")
    );
    expect(sendTextCall).toBeDefined();
    const body = JSON.parse(sendTextCall![1].body as string);
    expect(body.number).toBe("5511999999999");
    expect(body.text).toBe("Olá! Posso ajudar?");
  });
});
```

- [ ] **Step 2: Rodar testes para confirmar que falham**

```bash
pnpm --filter worker test src/workers/__tests__/send-message.test.ts
```

Esperado: FAIL — `sendPresence` não existe ainda.

- [ ] **Step 3: Implementar `sendPresence` e `randomDelay` em send-message.ts**

Substituir o conteúdo completo de `apps/worker/src/workers/send-message.ts`:

```ts
import { Worker } from "bullmq";
import { QUEUE_NAMES } from "@aula-agente/shared";
import type { SendMessageJobData } from "@aula-agente/queue";
import { getConnectionOptions } from "../lib/redis";
import { getAdminClient, getInstanceById } from "@aula-agente/database";

const EVOLUTION_API_URL = () => process.env.EVOLUTION_API_URL!;
const EVOLUTION_API_KEY = () => process.env.EVOLUTION_API_KEY!;

async function evolutionPost(path: string, body: unknown): Promise<void> {
  const response = await fetch(`${EVOLUTION_API_URL()}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: EVOLUTION_API_KEY(),
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Evolution API error ${response.status}: ${text}`);
  }
}

async function sendEvolutionText(instanceName: string, phone: string, text: string): Promise<void> {
  await evolutionPost(`/message/sendText/${encodeURIComponent(instanceName)}`, {
    number: phone,
    text,
  });
}

async function sendPresence(
  instanceName: string,
  phone: string,
  presence: "composing" | "paused"
): Promise<void> {
  try {
    await evolutionPost(`/chat/sendPresence/${encodeURIComponent(instanceName)}`, {
      number: phone,
      options: { presence },
    });
  } catch (err) {
    console.warn(`sendPresence(${presence}) failed (non-fatal):`, (err as Error).message);
  }
}

function randomDelay(min = 3000, max = 8000): Promise<void> {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function startSendMessageWorker() {
  const worker = new Worker<SendMessageJobData>(
    QUEUE_NAMES.SEND_MESSAGE,
    async (job) => {
      const { instanceId, phone, content } = job.data;

      const db = getAdminClient();
      const instance = await getInstanceById(db, instanceId);
      if (!instance) {
        throw new Error(`Instance ${instanceId} not found — cannot send message`);
      }

      await sendPresence(instance.instance_name, phone, "composing");
      await randomDelay();
      await sendEvolutionText(instance.instance_name, phone, content);
      await sendPresence(instance.instance_name, phone, "paused");

      console.log(`Sent message to ${phone} via instance ${instance.instance_name}`);
    },
    {
      connection: getConnectionOptions(),
      concurrency: 20,
      limiter: {
        max: 30,
        duration: 1000,
      },
    }
  );

  worker.on("failed", (job, err) => {
    console.error(`Send job ${job?.id} failed:`, err.message);
  });

  console.log("Send-message worker started");
  return worker;
}
```

- [ ] **Step 4: Rodar testes e confirmar que passam**

```bash
pnpm --filter worker test src/workers/__tests__/send-message.test.ts
```

Esperado: 5 testes PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/workers/send-message.ts apps/worker/src/workers/__tests__/send-message.test.ts
git commit -m "feat: indicador de digitação e delay aleatório no send-message worker"
```

---

### Task 2: Validação pós-resposta com guardrail LLM no agent-runner

**Files:**
- Modify: `apps/worker/src/agents/agent-runner.ts`
- Modify: `apps/worker/src/agents/__tests__/agent-runner.test.ts`

- [ ] **Step 1: Atualizar teste existente e adicionar testes de validação**

Em `apps/worker/src/agents/__tests__/agent-runner.test.ts`, primeiro corrigir o teste existente que vai falhar porque `tokensUsed` agora soma geração + validação (100 ao invés de 50):

```ts
// ANTES:
expect(result.tokensUsed).toBe(50);
// DEPOIS:
expect(result.tokensUsed).toBeGreaterThanOrEqual(50);
```

Em seguida adicionar os seguintes testes ao final do `describe("runAgent", () => { ... })`:

```ts
  it("retorna resposta diretamente se validador aprova na primeira tentativa", async () => {
    // generateText: 1ª chamada = resposta do agente, 2ª chamada = validador retorna compliant
    vi.mocked(generateText)
      .mockResolvedValueOnce({
        text: "Resposta ok",
        usage: { totalTokens: 50, promptTokens: 30, completionTokens: 20 },
        steps: [],
      } as never)
      .mockResolvedValueOnce({
        text: '{"compliant": true}',
        usage: { totalTokens: 10, promptTokens: 8, completionTokens: 2 },
        steps: [],
      } as never);

    const result = await runAgent({
      agent: baseAgent,
      messages: [],
      currentMessage,
      apiKey: "sk-test",
      organizationId: "org-1",
    });

    expect(result.text).toBe("Resposta ok");
    expect(vi.mocked(generateText)).toHaveBeenCalledTimes(2);
  });

  it("retenta e retorna segunda resposta se primeira viola regra", async () => {
    vi.mocked(generateText)
      .mockResolvedValueOnce({
        text: "Resposta ruim",
        usage: { totalTokens: 50, promptTokens: 30, completionTokens: 20 },
        steps: [],
      } as never)
      .mockResolvedValueOnce({
        text: '{"compliant": false, "violation": "mencionou concorrente"}',
        usage: { totalTokens: 10, promptTokens: 8, completionTokens: 2 },
        steps: [],
      } as never)
      .mockResolvedValueOnce({
        text: "Resposta corrigida",
        usage: { totalTokens: 50, promptTokens: 30, completionTokens: 20 },
        steps: [],
      } as never)
      .mockResolvedValueOnce({
        text: '{"compliant": true}',
        usage: { totalTokens: 10, promptTokens: 8, completionTokens: 2 },
        steps: [],
      } as never);

    const result = await runAgent({
      agent: baseAgent,
      messages: [],
      currentMessage,
      apiKey: "sk-test",
      organizationId: "org-1",
    });

    expect(result.text).toBe("Resposta corrigida");
    // 2 gerações + 2 validações = 4 chamadas
    expect(vi.mocked(generateText)).toHaveBeenCalledTimes(4);
  });

  it("retorna última resposta (fail open) se todas as 3 tentativas violam", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // 3 gerações + 3 validações = 6 chamadas
    vi.mocked(generateText)
      .mockResolvedValueOnce({ text: "Ruim 1", usage: { totalTokens: 50, promptTokens: 30, completionTokens: 20 }, steps: [] } as never)
      .mockResolvedValueOnce({ text: '{"compliant": false, "violation": "erro 1"}', usage: { totalTokens: 10, promptTokens: 8, completionTokens: 2 }, steps: [] } as never)
      .mockResolvedValueOnce({ text: "Ruim 2", usage: { totalTokens: 50, promptTokens: 30, completionTokens: 20 }, steps: [] } as never)
      .mockResolvedValueOnce({ text: '{"compliant": false, "violation": "erro 2"}', usage: { totalTokens: 10, promptTokens: 8, completionTokens: 2 }, steps: [] } as never)
      .mockResolvedValueOnce({ text: "Ruim 3", usage: { totalTokens: 50, promptTokens: 30, completionTokens: 20 }, steps: [] } as never)
      .mockResolvedValueOnce({ text: '{"compliant": false, "violation": "erro 3"}', usage: { totalTokens: 10, promptTokens: 8, completionTokens: 2 }, steps: [] } as never);

    const result = await runAgent({
      agent: baseAgent,
      messages: [],
      currentMessage,
      apiKey: "sk-test",
      organizationId: "org-1",
    });

    expect(result.text).toBe("Ruim 3");
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("erro 3"));
    warnSpy.mockRestore();
  });

  it("trata parse inválido do validador como compliant (fail open)", async () => {
    vi.mocked(generateText)
      .mockResolvedValueOnce({ text: "Resposta ok", usage: { totalTokens: 50, promptTokens: 30, completionTokens: 20 }, steps: [] } as never)
      .mockResolvedValueOnce({ text: "não é json", usage: { totalTokens: 10, promptTokens: 8, completionTokens: 2 }, steps: [] } as never);

    const result = await runAgent({
      agent: baseAgent,
      messages: [],
      currentMessage,
      apiKey: "sk-test",
      organizationId: "org-1",
    });

    expect(result.text).toBe("Resposta ok");
    expect(vi.mocked(generateText)).toHaveBeenCalledTimes(2);
  });

  it("inclui feedback da violation no system prompt da retentativa", async () => {
    vi.mocked(generateText)
      .mockResolvedValueOnce({ text: "Ruim", usage: { totalTokens: 50, promptTokens: 30, completionTokens: 20 }, steps: [] } as never)
      .mockResolvedValueOnce({ text: '{"compliant": false, "violation": "mencionou concorrente X"}', usage: { totalTokens: 10, promptTokens: 8, completionTokens: 2 }, steps: [] } as never)
      .mockResolvedValueOnce({ text: "Bom", usage: { totalTokens: 50, promptTokens: 30, completionTokens: 20 }, steps: [] } as never)
      .mockResolvedValueOnce({ text: '{"compliant": true}', usage: { totalTokens: 10, promptTokens: 8, completionTokens: 2 }, steps: [] } as never);

    await runAgent({
      agent: baseAgent,
      messages: [],
      currentMessage,
      apiKey: "sk-test",
      organizationId: "org-1",
    });

    // A 3ª chamada ao generateText é a retentativa — o system deve incluir a violation
    const retryCall = vi.mocked(generateText).mock.calls[2][0];
    expect((retryCall as { system: string }).system).toContain("mencionou concorrente X");
  });
```

- [ ] **Step 2: Rodar testes para confirmar que falham**

```bash
pnpm --filter worker test src/agents/__tests__/agent-runner.test.ts
```

Esperado: 4 novos testes FAIL — `validateResponse` não existe ainda.

- [ ] **Step 3: Implementar validação em agent-runner.ts**

Substituir o conteúdo completo de `apps/worker/src/agents/agent-runner.ts`:

```ts
import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { Agent, LLMProvider, Message } from "@aula-agente/shared";
import { buildToolsForAgent } from "./tools/registry";

interface RunAgentParams {
  agent: Agent;
  messages: Message[];
  currentMessage: Message;
  apiKey: string;
  organizationId: string;
}

interface RunAgentResult {
  text: string;
  model: string;
  tokensUsed: number;
  latencyMs: number;
  toolCalls: string[];
}

interface ValidationResult {
  compliant: boolean;
  violation?: string;
}

const VALIDATION_MODELS: Record<LLMProvider, string> = {
  openai: "gpt-4.1-nano",
  anthropic: "claude-haiku-4-20250414",
  google: "gemini-2.0-flash-lite",
};

const MAX_ATTEMPTS = 3;

function createModel(provider: LLMProvider, modelName: string, apiKey: string) {
  switch (provider) {
    case "openai": {
      const openai = createOpenAI({ apiKey });
      return openai(modelName);
    }
    case "anthropic": {
      const anthropic = createAnthropic({ apiKey });
      return anthropic(modelName);
    }
    case "google": {
      const google = createGoogleGenerativeAI({ apiKey });
      return google(modelName);
    }
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

function formatHistoryForLLM(messages: Message[]) {
  return messages
    .filter((msg) => msg.role === "contact" || msg.role === "agent")
    .map((msg) => ({
      role: msg.role === "contact" ? "user" as const : "assistant" as const,
      content: msg.content,
    }));
}

async function validateResponse(params: {
  systemPrompt: string;
  response: string;
  provider: LLMProvider;
  apiKey: string;
}): Promise<ValidationResult> {
  const { systemPrompt, response, provider, apiKey } = params;
  const validationModel = createModel(provider, VALIDATION_MODELS[provider], apiKey);

  const prompt = `Você é um verificador de conformidade. O system prompt abaixo contém regras que o assistente DEVE seguir. Verifique se a resposta gerada viola alguma regra explícita.

System prompt:
${systemPrompt}

Resposta gerada:
${response}

Responda APENAS com JSON válido, sem markdown:
{"compliant": true}
ou
{"compliant": false, "violation": "descrição breve da regra violada"}`;

  try {
    const result = await generateText({
      model: validationModel,
      prompt,
      maxTokens: 100,
      temperature: 0,
    });

    const parsed = JSON.parse(result.text.trim()) as ValidationResult;
    return parsed;
  } catch {
    return { compliant: true };
  }
}

export async function runAgent(params: RunAgentParams): Promise<RunAgentResult> {
  const { agent, messages, currentMessage, apiKey, organizationId } = params;

  const startTime = Date.now();
  const model = createModel(agent.provider, agent.model, apiKey);
  const tools = buildToolsForAgent({
    organizationId,
    agentId: agent.id,
    toolsConfig: agent.tools_config,
    apiKey,
  });
  const history = formatHistoryForLLM(messages);

  let totalTokens = 0;
  let allToolCalls: string[] = [];
  let lastText = "";
  let systemPrompt = agent.system_prompt;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const result = await generateText({
      model,
      system: systemPrompt,
      messages: [
        ...history,
        { role: "user", content: currentMessage.content },
      ],
      tools,
      maxSteps: agent.max_steps,
      temperature: agent.temperature,
      maxTokens: agent.max_tokens,
    });

    totalTokens += result.usage?.totalTokens || 0;
    allToolCalls = allToolCalls.concat(
      result.steps.flatMap((step) => step.toolCalls || []).map((tc) => tc.toolName)
    );
    lastText = result.text;

    const validation = await validateResponse({
      systemPrompt: agent.system_prompt,
      response: result.text,
      provider: agent.provider,
      apiKey,
    });

    if (validation.compliant) {
      break;
    }

    if (attempt === MAX_ATTEMPTS) {
      console.warn(
        `[agent-runner] Resposta enviada após ${MAX_ATTEMPTS} tentativas com violation: "${validation.violation}"`
      );
      break;
    }

    systemPrompt = `${agent.system_prompt}\n\n[ATENÇÃO: sua resposta anterior violou a seguinte regra: "${validation.violation}". Corrija na próxima resposta.]`;
  }

  return {
    text: lastText,
    model: agent.model,
    tokensUsed: totalTokens,
    latencyMs: Date.now() - startTime,
    toolCalls: allToolCalls,
  };
}
```

- [ ] **Step 4: Rodar todos os testes do worker**

```bash
pnpm --filter worker test
```

Esperado: todos os testes PASS (testes antigos + 5 novos de send-message + 5 novos de agent-runner).

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/agents/agent-runner.ts apps/worker/src/agents/__tests__/agent-runner.test.ts
git commit -m "feat: validação pós-resposta com guardrail LLM no agent-runner"
```
