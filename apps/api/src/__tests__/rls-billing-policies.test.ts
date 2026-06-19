import { describe, it, expect, beforeAll } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Lê todas as migrations SQL em ordem e concatena num único string.
// Isso permite verificar que as políticas corretas existem no snapshot final do schema.
function readAllMigrations(): string {
  const dir = join(__dirname, "../../../../supabase/migrations");
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  return files.map((f) => readFileSync(join(dir, f), "utf-8")).join("\n");
}

let sql: string;

beforeAll(() => {
  sql = readAllMigrations();
});

// ── subscriptions ────────────────────────────────────────────────────────────
// A tabela subscriptions é modificada APENAS pelo service_role (webhook handlers).
// Usuários autenticados devem poder APENAS ler a própria subscription.
// Políticas de deny explícitas convertem "seguro por omissão" em "seguro por intenção".

describe("RLS — subscriptions: write operations bloqueadas para authenticated", () => {
  it("T1: política SELECT existe para membros da org", () => {
    expect(sql).toContain('"subscriptions_select"');
  });

  it("T2: política de deny explícita para INSERT existe", () => {
    expect(sql).toContain('"subscriptions_no_insert"');
  });

  it("T3: política de deny explícita para UPDATE existe", () => {
    expect(sql).toContain('"subscriptions_no_update"');
  });

  it("T4: política de deny explícita para DELETE existe", () => {
    expect(sql).toContain('"subscriptions_no_delete"');
  });

  it("T5: INSERT deny usa WITH CHECK (false) para bloquear authenticated/anon", () => {
    // Garante que a política rejeita ativamente, não apenas não autoriza
    const insertBlock = sql.match(
      /"subscriptions_no_insert"[\s\S]*?WITH CHECK \(false\)/
    );
    expect(insertBlock).not.toBeNull();
  });

  it("T6: UPDATE deny usa USING (false) para bloquear authenticated/anon", () => {
    const updateBlock = sql.match(
      /"subscriptions_no_update"[\s\S]*?USING \(false\)/
    );
    expect(updateBlock).not.toBeNull();
  });

  it("T7: DELETE deny usa USING (false) para bloquear authenticated/anon", () => {
    const deleteBlock = sql.match(
      /"subscriptions_no_delete"[\s\S]*?USING \(false\)/
    );
    expect(deleteBlock).not.toBeNull();
  });
});

// ── billing_events ────────────────────────────────────────────────────────────
// billing_events é insert-only pelo service_role (webhook handlers).
// Nenhum usuário deve poder inserir, atualizar ou deletar eventos de cobrança.
// Previne auto-promoção de plano ou adulteração de histórico financeiro.

describe("RLS — billing_events: write operations bloqueadas para authenticated", () => {
  it("T8: política SELECT existe para owner/admin da org", () => {
    expect(sql).toContain('"billing_events_select"');
  });

  it("T9: política de deny explícita para INSERT existe", () => {
    expect(sql).toContain('"billing_events_no_insert"');
  });

  it("T10: política de deny explícita para UPDATE existe", () => {
    expect(sql).toContain('"billing_events_no_update"');
  });

  it("T11: política de deny explícita para DELETE existe", () => {
    expect(sql).toContain('"billing_events_no_delete"');
  });

  it("T12: INSERT deny usa WITH CHECK (false)", () => {
    const insertBlock = sql.match(
      /"billing_events_no_insert"[\s\S]*?WITH CHECK \(false\)/
    );
    expect(insertBlock).not.toBeNull();
  });

  it("T13: UPDATE deny usa USING (false)", () => {
    const updateBlock = sql.match(
      /"billing_events_no_update"[\s\S]*?USING \(false\)/
    );
    expect(updateBlock).not.toBeNull();
  });

  it("T14: DELETE deny usa USING (false)", () => {
    const deleteBlock = sql.match(
      /"billing_events_no_delete"[\s\S]*?USING \(false\)/
    );
    expect(deleteBlock).not.toBeNull();
  });
});
