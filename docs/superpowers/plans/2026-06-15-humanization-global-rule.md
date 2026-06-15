# Humanização Global Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Atualizar `send-message.ts` para dividir respostas longas por parágrafo e exibir o indicador "digitando..." antes de cada parte com delay proporcional ao tamanho.

**Architecture:** Toda a lógica fica em `send-message.ts`. A função `splitMessage` divide o texto por `\n\n` (máx 3 partes). `typingDelay` calcula o delay conforme o tamanho da parte. O job loop itera sobre as partes, exibindo typing + delay + envio para cada uma, com `shortPause` entre elas. Remarketing e agentes são cobertos automaticamente pois ambos enfileiram para `SEND_MESSAGE`.

**Tech Stack:** TypeScript, BullMQ, Vitest, Evolution API

---

## Arquivo modificado

| Arquivo | Mudança |
|---|---|
| `apps/worker/src/workers/send-message.ts` | Adicionar `splitMessage` (export), `typingDelay`, `shortPause`; substituir `randomDelay`; atualizar loop do job |
| `apps/worker/src/workers/__tests__/send-message.test.ts` | Adicionar testes para `splitMessage` e multi-part; ajustar testes existentes se necessário |

---

### Task 1: `splitMessage` — testes e implementação

**Files:**
- Modify: `apps/worker/src/workers/__tests__/send-message.test.ts`
- Modify: `apps/worker/src/workers/send-message.ts`

- [ ] **Step 1: Adicionar testes para `splitMessage` no arquivo de testes existente**

Abrir `apps/worker/src/workers/__tests__/send-message.test.ts` e adicionar o bloco abaixo **antes** do `describe("startSendMessageWorker", ...)` existente. O import de `splitMessage` vai junto ao import existente de `startSendMessageWorker`:

```ts
import { startSendMessageWorker, splitMessage } from "../send-message";
```

```ts
describe("splitMessage", () => {
  it("retorna array com 1 elemento para texto sem parágrafos", () => {
    expect(splitMessage("Olá tudo bem?")).toEqual(["Olá tudo bem?"]);
  });

  it("divide em 2 partes por \\n\\n", () => {
    expect(splitMessage("Parte 1\n\nParte 2")).toEqual(["Parte 1", "Parte 2"]);
  });

  it("remove partes vazias (múltiplas quebras consecutivas)", () => {
    expect(splitMessage("Parte 1\n\n\n\nParte 2")).toEqual(["Parte 1", "Parte 2"]);
  });

  it("limita a 3 partes e concatena o restante no 3º elemento", () => {
    expect(splitMessage("A\n\nB\n\nC\n\nD")).toEqual(["A", "B", "C\n\nD"]);
  });

  it("retorna array com 1 elemento para texto vazio", () => {
    expect(splitMessage("")).toEqual([""]);
  });

  it("retorna array com 1 elemento para texto com apenas \\n simples", () => {
    expect(splitMessage("linha 1\nlinha 2")).toEqual(["linha 1\nlinha 2"]);
  });
});
```

- [ ] **Step 2: Rodar o teste para confirmar que falha**

```bash
cd apps/worker && npx vitest run src/workers/__tests__/send-message.test.ts
```

Esperado: FAIL — `splitMessage is not exported` ou similar.

- [ ] **Step 3: Implementar `splitMessage` em `send-message.ts`**

Adicionar como export logo após os imports, antes de `sendEvolutionText`:

```ts
export function splitMessage(text: string): string[] {
  const parts = text.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return [text];
  if (parts.length <= 3) return parts;
  return [...parts.slice(0, 2), parts.slice(2).join("\n\n")];
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

```bash
cd apps/worker && npx vitest run src/workers/__tests__/send-message.test.ts
```

Esperado: todos os testes do `describe("splitMessage", ...)` PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/workers/send-message.ts apps/worker/src/workers/__tests__/send-message.test.ts
git commit -m "feat: adicionar splitMessage com limite de 3 parágrafos"
```

---

### Task 2: `typingDelay` e `shortPause` — substituir `randomDelay`

**Files:**
- Modify: `apps/worker/src/workers/__tests__/send-message.test.ts`
- Modify: `apps/worker/src/workers/send-message.ts`

- [ ] **Step 1: Adicionar testes para `typingDelay`**

Adicionar no arquivo de testes, após o `describe("splitMessage", ...)`:

Adicionar ao import:
```ts
import { startSendMessageWorker, splitMessage, typingDelay } from "../send-message";
```

```ts
describe("typingDelay", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("delay entre 1000–2000ms para texto curto (≤ 100 chars)", async () => {
    const spy = vi.spyOn(globalThis, "setTimeout");
    const p = typingDelay("a".repeat(50));
    vi.runAllTimers();
    await p;
    const delay = spy.mock.calls[0][1] as number;
    expect(delay).toBeGreaterThanOrEqual(1000);
    expect(delay).toBeLessThanOrEqual(2000);
  });

  it("delay entre 2000–4000ms para texto médio (101–300 chars)", async () => {
    const spy = vi.spyOn(globalThis, "setTimeout");
    const p = typingDelay("a".repeat(200));
    vi.runAllTimers();
    await p;
    const delay = spy.mock.calls[0][1] as number;
    expect(delay).toBeGreaterThanOrEqual(2000);
    expect(delay).toBeLessThanOrEqual(4000);
  });

  it("delay entre 3000–5000ms para texto longo (> 300 chars)", async () => {
    const spy = vi.spyOn(globalThis, "setTimeout");
    const p = typingDelay("a".repeat(400));
    vi.runAllTimers();
    await p;
    const delay = spy.mock.calls[0][1] as number;
    expect(delay).toBeGreaterThanOrEqual(3000);
    expect(delay).toBeLessThanOrEqual(5000);
  });
});
```

- [ ] **Step 2: Rodar para confirmar que falha**

```bash
cd apps/worker && npx vitest run src/workers/__tests__/send-message.test.ts
```

Esperado: FAIL — `typingDelay is not exported`.

- [ ] **Step 3: Implementar `typingDelay` e `shortPause` em `send-message.ts`, remover `randomDelay`**

Substituir a função `randomDelay` existente pelas duas funções abaixo:

```ts
export function typingDelay(text: string): Promise<void> {
  const len = text.length;
  let min: number, max: number;
  if (len <= 100) {
    min = 1000; max = 2000;
  } else if (len <= 300) {
    min = 2000; max = 4000;
  } else {
    min = 3000; max = 5000;
  }
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shortPause(): Promise<void> {
  const ms = Math.floor(Math.random() * 501) + 500;
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

- [ ] **Step 4: Rodar os testes**

```bash
cd apps/worker && npx vitest run src/workers/__tests__/send-message.test.ts
```

Esperado: todos os testes de `describe("typingDelay", ...)` PASS. Os testes existentes de `startSendMessageWorker` podem ainda estar passando (ainda não atualizamos o loop).

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/workers/send-message.ts apps/worker/src/workers/__tests__/send-message.test.ts
git commit -m "feat: adicionar typingDelay proporcional e shortPause, remover randomDelay"
```

---

### Task 3: Atualizar job loop e testes de integração

**Files:**
- Modify: `apps/worker/src/workers/send-message.ts`
- Modify: `apps/worker/src/workers/__tests__/send-message.test.ts`

- [ ] **Step 1: Adicionar teste de integração para mensagem multi-parte**

Adicionar dentro do `describe("startSendMessageWorker", ...)` existente, antes do último `it`:

```ts
it("mensagem com 2 parágrafos gera 2 composing + 2 paused + 2 sendText na ordem correta", async () => {
  const multiPartJob = {
    ...jobData,
    content: "Primeiro parágrafo.\n\nSegundo parágrafo.",
  };

  const { Worker } = await import("bullmq");
  // Reset e recria worker com novo jobData
  vi.clearAllMocks();
  vi.mocked(getInstanceById).mockResolvedValue({
    id: "inst-1",
    instance_name: "minha-instancia",
  } as never);
  mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) } as never);

  startSendMessageWorker();
  const workerInstance = vi.mocked(Worker).mock.results[0].value;
  const jobPromise = workerInstance._processor({ data: multiPartJob });
  jobPromise.catch(() => {});
  await vi.runAllTimersAsync();
  await jobPromise;

  const calls = mockFetch.mock.calls;

  // Extrair chamadas por tipo
  const presenceCalls = calls.filter((c) => (c[0] as string).includes("/chat/sendPresence/"));
  const sendTextCalls = calls.filter((c) => (c[0] as string).includes("/message/sendText/"));

  expect(presenceCalls.length).toBe(4); // 2 composing + 2 paused
  expect(sendTextCalls.length).toBe(2);

  // Verificar textos enviados
  const [firstText, secondText] = sendTextCalls.map((c) => JSON.parse(c[1].body as string).text);
  expect(firstText).toBe("Primeiro parágrafo.");
  expect(secondText).toBe("Segundo parágrafo.");

  // Verificar ordem: composing antes de cada sendText
  const allCallUrls = calls.map((c) => c[0] as string);
  const firstComposingIdx = allCallUrls.findIndex((u) => u.includes("/chat/sendPresence/"));
  const firstSendTextIdx = allCallUrls.findIndex((u) => u.includes("/message/sendText/"));
  expect(firstComposingIdx).toBeLessThan(firstSendTextIdx);
});

it("mensagem sem parágrafo gera 1 composing + 1 paused + 1 sendText", async () => {
  await runJob();

  const calls = mockFetch.mock.calls;
  const presenceCalls = calls.filter((c) => (c[0] as string).includes("/chat/sendPresence/"));
  const sendTextCalls = calls.filter((c) => (c[0] as string).includes("/message/sendText/"));

  expect(presenceCalls.length).toBe(2);
  expect(sendTextCalls.length).toBe(1);
});
```

- [ ] **Step 2: Rodar para confirmar que o teste multi-parte falha**

```bash
cd apps/worker && npx vitest run src/workers/__tests__/send-message.test.ts
```

Esperado: o teste "mensagem com 2 parágrafos" FAIL — atualmente só envia 1 texto.

- [ ] **Step 3: Atualizar o job loop em `send-message.ts`**

Substituir o trecho dentro de `async (job) => { ... }` após o fetch da instância. O bloco atual:

```ts
await sendPresence(instance.instance_name, phone, "composing");
await randomDelay();
try {
  await sendEvolutionText(instance.instance_name, phone, content);
} finally {
  await sendPresence(instance.instance_name, phone, "paused");
}
```

Deve ser substituído por:

```ts
const parts = splitMessage(content);
for (let i = 0; i < parts.length; i++) {
  const part = parts[i];
  await sendPresence(instance.instance_name, phone, "composing");
  await typingDelay(part);
  try {
    await sendEvolutionText(instance.instance_name, phone, part);
  } finally {
    await sendPresence(instance.instance_name, phone, "paused");
  }
  if (i < parts.length - 1) {
    await shortPause();
  }
}
```

- [ ] **Step 4: Rodar todos os testes do worker**

```bash
cd apps/worker && npx vitest run src/workers/__tests__/send-message.test.ts
```

Esperado: todos os testes PASS. Os testes existentes continuam passando pois usam `jobData.content = "Olá! Posso ajudar?"` (sem `\n\n`, 1 parte).

- [ ] **Step 5: Rodar suite completa do worker**

```bash
cd apps/worker && npm test
```

Esperado: todos os testes PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/workers/send-message.ts apps/worker/src/workers/__tests__/send-message.test.ts
git commit -m "feat: loop multi-parte com typing proporcional por parágrafo (regra global de humanização)"
```

---

## Pós-implementação: Code Review

Antes de considerar o trabalho concluído, executar `/code-review` sobre o diff para validação. O plano cobre agentes e remarketing — não há outros arquivos a modificar.
