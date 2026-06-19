import { describe, it, expect, vi, beforeEach } from "vitest";
import { getConversationsEligibleForEnrollment } from "@aula-agente/database";

// ── helpers ────────────────────────────────────────────────────────────────────

/**
 * Constrói um cliente Supabase encadeável onde cada tabela
 * retorna um objeto diferente. Qualquer método encadeado devolve
 * o próprio chain (thenable), então `await chain.select(...).eq(...)...`
 * funciona sem importar onde a cadeia termina.
 */
function makeChain(resolvedValue: Record<string, unknown>) {
  const self: Record<string, unknown> = {};

  // Thenable — `await chain` resolve com resolvedValue
  self["then"] = (resolve: (v: unknown) => unknown) =>
    Promise.resolve(resolvedValue).then(resolve);
  self["catch"] = (reject: (v: unknown) => unknown) =>
    Promise.resolve(resolvedValue).catch(reject);

  const methods = ["select", "eq", "in", "gt", "lt", "order", "limit", "maybeSingle", "single"];
  for (const m of methods) {
    (self as any)[m] = vi.fn().mockReturnValue(self);
  }
  return self;
}

type MockClient = {
  from: ReturnType<typeof vi.fn>;
  _convChain: Record<string, unknown>;
  _enrollChain: Record<string, unknown>;
  _msgChain: Record<string, unknown>;
};

function buildMockClient({
  conversations = [] as { id: string; organization_id: string }[],
  enrolled = [] as { conversation_id: string }[],
  recentMsgs = [] as { conversation_id: string }[],
} = {}): MockClient {
  const convChain = makeChain({ data: conversations, error: null });
  const enrollChain = makeChain({ data: enrolled, error: null });
  const msgChain = makeChain({ data: recentMsgs, error: null });

  const from = vi.fn((table: string) => {
    if (table === "conversations") return convChain;
    if (table === "remarketing_enrollments") return enrollChain;
    if (table === "messages") return msgChain;
    throw new Error(`Unexpected table: "${table}"`);
  });

  return { from, _convChain: convChain, _enrollChain: enrollChain, _msgChain: msgChain };
}

// ── fixtures ───────────────────────────────────────────────────────────────────

const BASE_FLOW = {
  id: "flow-1",
  organization_id: "org-1",
  name: "Fluxo Teste",
  product_campaign: "campanha-1",
  agent_id: "agent-1",
  instance_id: "inst-1",
  status: "active" as const,
  cancel_on_reply: false,
  cancel_on_resolved: true,
  cancel_on_opt_out: false,
  entry_silence_minutes: 15,
  system_prompt: "",
  last_executed_at: null,
  next_check_at: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const makeConv = (id: string) => ({ id, organization_id: "org-1" });

// ── N+1 elimination tests (RED → GREEN) ───────────────────────────────────────

describe("getConversationsEligibleForEnrollment — eliminação N+1", () => {
  it("T1: client.from('messages') é chamado exatamente 1 vez para 3 conversas candidatas", async () => {
    const conv1 = makeConv("conv-1");
    const conv2 = makeConv("conv-2");
    const conv3 = makeConv("conv-3");

    const client = buildMockClient({
      conversations: [conv1, conv2, conv3],
      enrolled: [],       // nenhuma já inscrita
      recentMsgs: [],     // nenhuma com mensagem recente → todas elegíveis
    });

    await getConversationsEligibleForEnrollment(client as any, BASE_FLOW);

    const messagesCalls = (client.from as ReturnType<typeof vi.fn>).mock.calls.filter(
      (args: unknown[]) => args[0] === "messages"
    );
    // Antes da correção: 3 chamadas (uma por candidata)
    // Depois da correção: 1 chamada (batch com .in())
    expect(messagesCalls).toHaveLength(1);
  });

  it("T2: a query de messages usa .in() com todos os IDs das candidatas", async () => {
    const conv1 = makeConv("conv-1");
    const conv2 = makeConv("conv-2");
    const conv3 = makeConv("conv-3");

    const client = buildMockClient({
      conversations: [conv1, conv2, conv3],
      enrolled: [],
      recentMsgs: [],
    });

    await getConversationsEligibleForEnrollment(client as any, BASE_FLOW);

    // O método .in() no chain de messages deve ter sido chamado com todos os IDs
    const inSpy = (client._msgChain as any)["in"] as ReturnType<typeof vi.fn>;
    expect(inSpy).toHaveBeenCalledTimes(1);
    expect(inSpy).toHaveBeenCalledWith(
      "conversation_id",
      expect.arrayContaining(["conv-1", "conv-2", "conv-3"])
    );
  });

  it("T3: sem candidatas → messages não é consultado", async () => {
    const client = buildMockClient({
      conversations: [],
      enrolled: [],
      recentMsgs: [],
    });

    const result = await getConversationsEligibleForEnrollment(client as any, BASE_FLOW);

    const messagesCalls = (client.from as ReturnType<typeof vi.fn>).mock.calls.filter(
      (args: unknown[]) => args[0] === "messages"
    );
    expect(messagesCalls).toHaveLength(0);
    expect(result).toEqual([]);
  });

  it("T4: todas as candidatas já inscritas → messages não é consultado", async () => {
    const conv1 = makeConv("conv-1");
    const conv2 = makeConv("conv-2");

    const client = buildMockClient({
      conversations: [conv1, conv2],
      enrolled: [{ conversation_id: "conv-1" }, { conversation_id: "conv-2" }],
      recentMsgs: [],
    });

    const result = await getConversationsEligibleForEnrollment(client as any, BASE_FLOW);

    const messagesCalls = (client.from as ReturnType<typeof vi.fn>).mock.calls.filter(
      (args: unknown[]) => args[0] === "messages"
    );
    expect(messagesCalls).toHaveLength(0);
    expect(result).toEqual([]);
  });

  it("T5: conversas com mensagem recente são excluídas do resultado", async () => {
    const conv1 = makeConv("conv-1"); // ativa (sem msg recente)
    const conv2 = makeConv("conv-2"); // tem msg recente → não elegível

    const client = buildMockClient({
      conversations: [conv1, conv2],
      enrolled: [],
      recentMsgs: [{ conversation_id: "conv-2" }], // conv-2 tem atividade
    });

    const result = await getConversationsEligibleForEnrollment(client as any, BASE_FLOW);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("conv-1");
  });

  it("T6: conversas sem mensagem recente são incluídas", async () => {
    const conv1 = makeConv("conv-a");
    const conv2 = makeConv("conv-b");

    const client = buildMockClient({
      conversations: [conv1, conv2],
      enrolled: [],
      recentMsgs: [], // nenhuma tem atividade → ambas elegíveis
    });

    const result = await getConversationsEligibleForEnrollment(client as any, BASE_FLOW);

    expect(result).toHaveLength(2);
    expect(result.map((c) => c.id)).toEqual(expect.arrayContaining(["conv-a", "conv-b"]));
  });

  it("T7: mistura — inscrita, com msg recente, sem msg recente → só a sem msg recente é elegível", async () => {
    const conv1 = makeConv("enrolled");   // já inscrita
    const conv2 = makeConv("active");     // tem msg recente
    const conv3 = makeConv("silent");     // sem msg recente → elegível

    const client = buildMockClient({
      conversations: [conv1, conv2, conv3],
      enrolled: [{ conversation_id: "enrolled" }],
      recentMsgs: [{ conversation_id: "active" }],
    });

    const result = await getConversationsEligibleForEnrollment(client as any, BASE_FLOW);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("silent");
  });
});
