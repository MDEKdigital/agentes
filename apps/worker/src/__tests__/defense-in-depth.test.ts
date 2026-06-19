/**
 * Testes de defense-in-depth para filtro de organization_id (S4).
 *
 * Cada mutação crítica deve aplicar .eq("organization_id", ...) como
 * segundo filtro DB, além do .eq("id", ...) primário.
 * Isso garante que um bug de autorização na camada de API não permita
 * que um usuário de uma org modifique dados de outra org.
 */
import { describe, it, expect, vi } from "vitest";
import {
  updateConversation,
  reopenConversation,
  updateInstance,
  cancelEnrollment,
  advanceEnrollment,
  returnConversationToAgent,
} from "@aula-agente/database";

// ── mock de chain Supabase que rastreia chamadas .eq() ────────────────────────

type EqPair = [string, unknown];

function makeSpyChain(data: unknown = null, error: unknown = null) {
  const eqArgs: EqPair[] = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {
    then: (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data, error }).then(resolve),
    catch: (reject: (e: unknown) => unknown) =>
      Promise.resolve({ data, error }).catch(reject),
    _eqArgs: eqArgs,
  };

  for (const m of [
    "update", "delete", "select", "single", "maybeSingle",
    "or", "in", "gt", "lt", "not", "order", "limit", "insert",
  ]) {
    chain[m] = vi.fn(() => chain);
  }

  chain.eq = vi.fn((col: string, val: unknown) => {
    eqArgs.push([col, val]);
    return chain;
  });

  return chain as typeof chain & { _eqArgs: EqPair[]; eq: ReturnType<typeof vi.fn> };
}

function buildDb(chain: ReturnType<typeof makeSpyChain>) {
  return { from: vi.fn(() => chain) };
}

const ID = "target-id";
const ORG = "org-uuid-1";

// ── 1. updateConversation ─────────────────────────────────────────────────────

describe("updateConversation — defense-in-depth", () => {
  it("T1: filtra por organization_id além de id", async () => {
    const chain = makeSpyChain({ id: ID });
    const db = buildDb(chain);
    await updateConversation(db as never, ID, { status: "open" }, ORG);
    const cols = chain._eqArgs.map(([c]: EqPair) => c);
    expect(cols).toContain("id");
    expect(cols).toContain("organization_id");
  });

  it("T2: organization_id passado ao filtro é o correto", async () => {
    const chain = makeSpyChain({ id: ID });
    const db = buildDb(chain);
    await updateConversation(db as never, ID, {}, ORG);
    const orgFilter = chain._eqArgs.find(([c]: EqPair) => c === "organization_id");
    expect(orgFilter).toBeDefined();
    expect(orgFilter![1]).toBe(ORG);
  });
});

// ── 2. reopenConversation ─────────────────────────────────────────────────────

describe("reopenConversation — defense-in-depth", () => {
  it("T3: filtra por organization_id além de id", async () => {
    // data=objeto → segue o caminho do return de data direto
    const chain = makeSpyChain({ id: ID, status: "open" });
    const db = buildDb(chain);
    await reopenConversation(db as never, ID, ORG);
    const cols = chain._eqArgs.map(([c]: EqPair) => c);
    expect(cols).toContain("id");
    expect(cols).toContain("organization_id");
  });

  it("T4: organization_id passado ao filtro é o correto", async () => {
    const chain = makeSpyChain({ id: ID, status: "open" });
    const db = buildDb(chain);
    await reopenConversation(db as never, ID, ORG);
    const orgFilter = chain._eqArgs.find(([c]: EqPair) => c === "organization_id");
    expect(orgFilter![1]).toBe(ORG);
  });
});

// ── 3. updateInstance ─────────────────────────────────────────────────────────

describe("updateInstance — defense-in-depth", () => {
  it("T5: filtra por organization_id além de id", async () => {
    const chain = makeSpyChain({ id: ID });
    const db = buildDb(chain);
    await updateInstance(db as never, ID, { status: "connected" }, ORG);
    const cols = chain._eqArgs.map(([c]: EqPair) => c);
    expect(cols).toContain("id");
    expect(cols).toContain("organization_id");
  });

  it("T6: organization_id passado ao filtro é o correto", async () => {
    const chain = makeSpyChain({ id: ID });
    const db = buildDb(chain);
    await updateInstance(db as never, ID, {}, ORG);
    const orgFilter = chain._eqArgs.find(([c]: EqPair) => c === "organization_id");
    expect(orgFilter![1]).toBe(ORG);
  });
});

// ── 4. cancelEnrollment ───────────────────────────────────────────────────────

describe("cancelEnrollment — defense-in-depth", () => {
  it("T7: filtra por organization_id além de id", async () => {
    const chain = makeSpyChain(null);
    const db = buildDb(chain);
    await cancelEnrollment(db as never, ID, "resolved", ORG);
    const cols = chain._eqArgs.map(([c]: EqPair) => c);
    expect(cols).toContain("id");
    expect(cols).toContain("organization_id");
  });

  it("T8: organization_id passado ao filtro é o correto", async () => {
    const chain = makeSpyChain(null);
    const db = buildDb(chain);
    await cancelEnrollment(db as never, ID, "resolved", ORG);
    const orgFilter = chain._eqArgs.find(([c]: EqPair) => c === "organization_id");
    expect(orgFilter![1]).toBe(ORG);
  });
});

// ── 5. advanceEnrollment ──────────────────────────────────────────────────────

describe("advanceEnrollment — defense-in-depth", () => {
  it("T9: filtra por organization_id além de id", async () => {
    const chain = makeSpyChain(null);
    const db = buildDb(chain);
    await advanceEnrollment(db as never, ID, null, ORG);
    const cols = chain._eqArgs.map(([c]: EqPair) => c);
    expect(cols).toContain("id");
    expect(cols).toContain("organization_id");
  });

  it("T10: organization_id passado ao filtro é o correto", async () => {
    const chain = makeSpyChain(null);
    const db = buildDb(chain);
    await advanceEnrollment(db as never, ID, "step-2", ORG);
    const orgFilter = chain._eqArgs.find(([c]: EqPair) => c === "organization_id");
    expect(orgFilter![1]).toBe(ORG);
  });
});

// ── 6. returnConversationToAgent ──────────────────────────────────────────────

describe("returnConversationToAgent — defense-in-depth", () => {
  it("T11: filtra por organization_id além de id", async () => {
    const chain = makeSpyChain(null);
    const db = buildDb(chain);
    await returnConversationToAgent(db as never, ID, "agent-1", ORG);
    const cols = chain._eqArgs.map(([c]: EqPair) => c);
    expect(cols).toContain("id");
    expect(cols).toContain("organization_id");
  });

  it("T12: organization_id passado ao filtro é o correto", async () => {
    const chain = makeSpyChain(null);
    const db = buildDb(chain);
    await returnConversationToAgent(db as never, ID, "agent-1", ORG);
    const orgFilter = chain._eqArgs.find(([c]: EqPair) => c === "organization_id");
    expect(orgFilter![1]).toBe(ORG);
  });
});
