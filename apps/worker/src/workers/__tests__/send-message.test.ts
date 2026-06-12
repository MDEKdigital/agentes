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
});
