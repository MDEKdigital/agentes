import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
import { startSendMessageWorker, splitMessage, typingDelay } from "../send-message";

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
  jobPromise.catch(() => {}); // previne unhandled rejection durante runAllTimersAsync
  await vi.runAllTimersAsync();
  return jobPromise;
}

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

  it("retorna array com string vazia para texto apenas com espaços", () => {
    expect(splitMessage("   ")).toEqual([""]);
  });

  it("mantém quebras \\n\\n no 3º elemento ao concatenar overflow", () => {
    expect(splitMessage("A\n\nB\n\nC\n\n\n\nD")).toEqual(["A", "B", "C\n\nD"]);
  });
});

describe("typingDelay", () => {
  it("delay entre 1000–2000ms para texto curto (≤ 100 chars)", async () => {
    const spy = vi.spyOn(globalThis, "setTimeout");
    const p = typingDelay("a".repeat(50));
    vi.runAllTimers();
    await p;
    expect(spy).toHaveBeenCalledOnce();
    const delay = spy.mock.calls[0][1] as number;
    expect(delay).toBeGreaterThanOrEqual(1000);
    expect(delay).toBeLessThanOrEqual(2000);
  });

  it("delay entre 2000–4000ms para texto médio (101–300 chars)", async () => {
    const spy = vi.spyOn(globalThis, "setTimeout");
    const p = typingDelay("a".repeat(200));
    vi.runAllTimers();
    await p;
    expect(spy).toHaveBeenCalledOnce();
    const delay = spy.mock.calls[0][1] as number;
    expect(delay).toBeGreaterThanOrEqual(2000);
    expect(delay).toBeLessThanOrEqual(4000);
  });

  it("delay entre 3000–5000ms para texto longo (> 300 chars)", async () => {
    const spy = vi.spyOn(globalThis, "setTimeout");
    const p = typingDelay("a".repeat(400));
    vi.runAllTimers();
    await p;
    expect(spy).toHaveBeenCalledOnce();
    const delay = spy.mock.calls[0][1] as number;
    expect(delay).toBeGreaterThanOrEqual(3000);
    expect(delay).toBeLessThanOrEqual(5000);
  });
});

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

  it("envia sendPresence paused mesmo quando sendEvolutionText falha", async () => {
    // sendPresence composing OK, sendText falha, sendPresence paused deve ainda ser chamado
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) } as never) // composing OK
      .mockResolvedValueOnce({ ok: false, text: async () => "Internal Server Error" } as never) // sendText falha
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) } as never); // paused OK

    await expect(runJob()).rejects.toThrow();

    const presenceCalls = mockFetch.mock.calls.filter((c) =>
      (c[0] as string).includes("/chat/sendPresence/")
    );
    expect(presenceCalls.length).toBe(2);
    const lastPresenceBody = JSON.parse(presenceCalls[1][1].body as string);
    expect(lastPresenceBody.options.presence).toBe("paused");
  });

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
});
