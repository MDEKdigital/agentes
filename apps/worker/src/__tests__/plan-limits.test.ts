import { describe, it, expect, vi } from "vitest";
import { checkResourceLimit, getOrgPlanLimits } from "@aula-agente/database";

// ── helpers ────────────────────────────────────────────────────────────────────

/**
 * Constrói um chain Supabase encadeável e thenable.
 * Qualquer método intermediário retorna o próprio chain;
 * `await chain` resolve com `resolvedValue`.
 */
function makeChain(resolvedValue: Record<string, unknown>) {
  const self: Record<string, unknown> = {};
  self["then"] = (resolve: (v: unknown) => unknown) =>
    Promise.resolve(resolvedValue).then(resolve);
  self["catch"] = (reject: (v: unknown) => unknown) =>
    Promise.resolve(resolvedValue).catch(reject);

  const methods = ["select", "eq", "in", "gt", "lt", "order", "limit", "maybeSingle", "single"];
  for (const m of methods) {
    (self as any)[m] = vi.fn().mockReturnValue(self);
  }
  return self as typeof self & { [k: string]: ReturnType<typeof vi.fn> };
}

const PLAN_LIMITS = { max_agents: 5, max_instances: 3, max_members: 10 };
const ORG_ID = "org-uuid-1";

/**
 * Constrói um cliente mock configurado para o padrão NEW (JOIN via embedded resource).
 * subscriptions retorna `{ data: { plans: PLAN_LIMITS } }` — como PostgREST embedded join.
 * resource table retorna `{ count }`.
 */
function buildClient({
  planData = { plans: PLAN_LIMITS } as Record<string, unknown> | null,
  resourceCount = 0,
}: {
  planData?: Record<string, unknown> | null;
  resourceCount?: number;
} = {}) {
  const subsChain = makeChain({ data: planData, error: null });
  const resourceChain = makeChain({ count: resourceCount, data: null, error: null });
  // plans table chain — para detectar se o código ainda consulta plans separadamente
  const plansChain = makeChain({ data: PLAN_LIMITS, error: null });

  const from = vi.fn((table: string) => {
    if (table === "subscriptions") return subsChain;
    if (table === "plans") return plansChain;
    // Qualquer tabela de recurso (agents, evolution_instances, organization_members)
    return resourceChain;
  });

  return {
    from,
    _subsChain: subsChain,
    _plansChain: plansChain,
    _resourceChain: resourceChain,
  };
}

// ── testes de eliminação de round-trips sequenciais ────────────────────────────

describe("checkResourceLimit — 3 queries sequenciais → 2 paralelas", () => {
  it("T1: from('plans') nunca é chamado diretamente (plans vêm via embedded resource)", async () => {
    const client = buildClient({ planData: { plans: PLAN_LIMITS }, resourceCount: 2 });

    await checkResourceLimit(client as any, ORG_ID, "agents");

    const plansCalls = (client.from as ReturnType<typeof vi.fn>).mock.calls.filter(
      (args: unknown[]) => args[0] === "plans"
    );
    // Antes: from("plans") era chamado explicitamente (query 2 de 3)
    // Depois: plans vêm embutidos na query de subscriptions
    expect(plansCalls).toHaveLength(0);
  });

  it("T2: from('subscriptions') é chamado exatamente 1 vez (não 2)", async () => {
    const client = buildClient({ planData: { plans: PLAN_LIMITS }, resourceCount: 1 });

    await checkResourceLimit(client as any, ORG_ID, "agents");

    const subsCalls = (client.from as ReturnType<typeof vi.fn>).mock.calls.filter(
      (args: unknown[]) => args[0] === "subscriptions"
    );
    expect(subsCalls).toHaveLength(1);
  });

  it("T3: sem assinatura ativa → allowed: true, max: null", async () => {
    const client = buildClient({ planData: null, resourceCount: 0 });

    const result = await checkResourceLimit(client as any, ORG_ID, "agents");

    expect(result).toEqual({ allowed: true, current: 0, max: null });
  });

  it("T4: uso abaixo do limite → allowed: true", async () => {
    // max_agents = 5, current = 2
    const client = buildClient({ planData: { plans: PLAN_LIMITS }, resourceCount: 2 });

    const result = await checkResourceLimit(client as any, ORG_ID, "agents");

    expect(result).toEqual({ allowed: true, current: 2, max: 5 });
  });

  it("T5: uso no limite exato → allowed: false", async () => {
    // max_agents = 5, current = 5
    const client = buildClient({ planData: { plans: PLAN_LIMITS }, resourceCount: 5 });

    const result = await checkResourceLimit(client as any, ORG_ID, "agents");

    expect(result).toEqual({ allowed: false, current: 5, max: 5 });
  });

  it("T6: uso acima do limite → allowed: false", async () => {
    const client = buildClient({ planData: { plans: PLAN_LIMITS }, resourceCount: 7 });

    const result = await checkResourceLimit(client as any, ORG_ID, "agents");

    expect(result).toEqual({ allowed: false, current: 7, max: 5 });
  });

  it("T7: resource 'instances' usa max_instances do plan", async () => {
    // max_instances = 3, current = 2
    const client = buildClient({ planData: { plans: PLAN_LIMITS }, resourceCount: 2 });

    const result = await checkResourceLimit(client as any, ORG_ID, "instances");

    expect(result).toEqual({ allowed: true, current: 2, max: 3 });
  });

  it("T8: resource 'members' usa max_members do plan", async () => {
    // max_members = 10, current = 10
    const client = buildClient({ planData: { plans: PLAN_LIMITS }, resourceCount: 10 });

    const result = await checkResourceLimit(client as any, ORG_ID, "members");

    expect(result).toEqual({ allowed: false, current: 10, max: 10 });
  });
});

describe("getOrgPlanLimits — JOIN subscriptions+plans em 1 query", () => {
  it("T9: from('plans') nunca é chamado diretamente", async () => {
    const client = buildClient({ planData: { plans: PLAN_LIMITS } });

    await getOrgPlanLimits(client as any, ORG_ID);

    const plansCalls = (client.from as ReturnType<typeof vi.fn>).mock.calls.filter(
      (args: unknown[]) => args[0] === "plans"
    );
    expect(plansCalls).toHaveLength(0);
  });

  it("T10: retorna os limites corretos do plan embutido", async () => {
    const client = buildClient({ planData: { plans: PLAN_LIMITS } });

    const result = await getOrgPlanLimits(client as any, ORG_ID);

    expect(result).toEqual({
      max_agents: 5,
      max_instances: 3,
      max_members: 10,
    });
  });

  it("T11: sem assinatura ativa → retorna null", async () => {
    const client = buildClient({ planData: null });

    const result = await getOrgPlanLimits(client as any, ORG_ID);

    expect(result).toBeNull();
  });
});
