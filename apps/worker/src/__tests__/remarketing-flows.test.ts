import { describe, it, expect, vi } from "vitest";
import { getActiveRemarketingFlows, updateFlowLastExecuted } from "@aula-agente/database";

// ── helper: chain Supabase encadeável ─────────────────────────────────────────

function makeChain(resolvedValue: Record<string, unknown>) {
  const spies: Record<string, ReturnType<typeof vi.fn>> = {};
  const self: Record<string, unknown> = {};

  self["then"] = (resolve: (v: unknown) => unknown) =>
    Promise.resolve(resolvedValue).then(resolve);
  self["catch"] = (reject: (v: unknown) => unknown) =>
    Promise.resolve(resolvedValue).catch(reject);

  const methods = ["select", "eq", "or", "lte", "is", "order", "limit", "update", "maybeSingle", "single"];
  for (const m of methods) {
    const spy = vi.fn().mockReturnValue(self);
    spies[m] = spy;
    self[m] = spy;
  }

  return { chain: self, spies };
}

function buildFlowsClient(flows: unknown[] = []) {
  const { chain, spies } = makeChain({ data: flows, error: null });
  const from = vi.fn().mockReturnValue(chain);
  return { from, spies };
}

// ── fixtures ──────────────────────────────────────────────────────────────────

const FLOW_ID = "flow-uuid-1";

// ── getActiveRemarketingFlows ─────────────────────────────────────────────────

describe("getActiveRemarketingFlows — filtrar por next_check_at", () => {
  it("T1: query inclui filtro que aceita next_check_at IS NULL (novos flows)", async () => {
    const { from, spies } = buildFlowsClient([]);
    const client = { from };

    await getActiveRemarketingFlows(client as any);

    // O .or() deve conter 'next_check_at.is.null'
    const orSpy = spies["or"];
    expect(orSpy).toHaveBeenCalled();
    const orArg: string = orSpy.mock.calls[0][0];
    expect(orArg).toContain("next_check_at.is.null");
  });

  it("T2: query inclui filtro next_check_at <= agora para flows elegíveis", async () => {
    const { from, spies } = buildFlowsClient([]);
    const client = { from };

    await getActiveRemarketingFlows(client as any);

    const orSpy = spies["or"];
    expect(orSpy).toHaveBeenCalled();
    const orArg: string = orSpy.mock.calls[0][0];
    // Deve conter lte (less-than-or-equal) para next_check_at
    expect(orArg).toContain("next_check_at.lte.");
  });

  it("T3: filtro .eq('status', 'active') ainda é aplicado", async () => {
    const { from, spies } = buildFlowsClient([]);
    const client = { from };

    await getActiveRemarketingFlows(client as any);

    expect(spies["eq"]).toHaveBeenCalledWith("status", "active");
  });
});

// ── updateFlowLastExecuted ────────────────────────────────────────────────────

describe("updateFlowLastExecuted — incluir next_check_at no UPDATE", () => {
  it("T4: update payload inclui next_check_at quando passado", async () => {
    const { chain, spies } = makeChain({ error: null });
    const from = vi.fn().mockReturnValue(chain);
    const client = { from };
    const futureTime = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    await updateFlowLastExecuted(client as any, FLOW_ID, futureTime);

    expect(spies["update"]).toHaveBeenCalledWith(
      expect.objectContaining({ next_check_at: futureTime })
    );
  });

  it("T5: update payload inclui last_executed_at (comportamento preservado)", async () => {
    const { chain, spies } = makeChain({ error: null });
    const from = vi.fn().mockReturnValue(chain);
    const client = { from };
    const futureTime = new Date(Date.now() + 60_000).toISOString();

    await updateFlowLastExecuted(client as any, FLOW_ID, futureTime);

    expect(spies["update"]).toHaveBeenCalledWith(
      expect.objectContaining({ last_executed_at: expect.any(String) })
    );
  });

  it("T6: sem nextCheckAt explícito → update ainda inclui next_check_at com valor futuro", async () => {
    const { chain, spies } = makeChain({ error: null });
    const from = vi.fn().mockReturnValue(chain);
    const client = { from };
    const before = new Date().toISOString();

    await updateFlowLastExecuted(client as any, FLOW_ID);

    const payload = spies["update"].mock.calls[0][0] as Record<string, string>;
    expect(payload.next_check_at).toBeDefined();
    // O valor padrão deve ser no futuro (maior que agora)
    expect(payload.next_check_at > before).toBe(true);
  });

  it("T7: .eq('id', flowId) filtro aplicado corretamente", async () => {
    const { chain, spies } = makeChain({ error: null });
    const from = vi.fn().mockReturnValue(chain);
    const client = { from };

    await updateFlowLastExecuted(client as any, FLOW_ID, new Date(Date.now() + 60_000).toISOString());

    expect(spies["eq"]).toHaveBeenCalledWith("id", FLOW_ID);
  });
});
