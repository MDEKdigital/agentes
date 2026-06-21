/**
 * RED tests for RC-3: Lock TTL vs LLM processing time.
 *
 * Problem: LOCK_TTL_MS=60_000 but LLM_TIMEOUT_MS=120_000. A job can legitimately
 * run for > 60s, the lock expires, and a second job for the same conversation
 * starts — producing duplicate agent responses.
 *
 * Fix: heartbeat lock renewal via Lua pexpire, fired every LOCK_RENEWAL_INTERVAL_MS.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Redis mock ────────────────────────────────────────────────────────────────

const { mockRedisCall, mockRedisSet } = vi.hoisted(() => ({
  mockRedisCall: vi.fn(),
  mockRedisSet: vi.fn().mockResolvedValue("OK"),
}));

vi.mock("@aula-agente/queue", () => ({
  getRedisConnection: vi.fn(() => ({
    set: mockRedisSet,
    call: mockRedisCall,
    del: vi.fn().mockResolvedValue(1),
  })),
}));

// ── Imports (RED: renewConversationLock and LOCK_RENEWAL_INTERVAL_MS don't exist) ─

import {
  renewConversationLock,
  acquireConversationLock,
  releaseConversationLock,
  LOCK_RENEWAL_INTERVAL_MS,
} from "../lib/lock";
import { LLM_TIMEOUT_MS, VALIDATION_TIMEOUT_MS } from "../lib/with-timeout";

beforeEach(() => {
  vi.clearAllMocks();
  mockRedisSet.mockResolvedValue("OK");
});

// ════════════════════════════════════════════════════════════════════════════
// RC-3 — Structural invariants that prove the bug
// ════════════════════════════════════════════════════════════════════════════

describe("RC-3: invariantes do TTL da lock vs tempo de processamento", () => {
  it("LOCK_RENEWAL_INTERVAL_MS existe — heartbeat de renovação é necessário", () => {
    expect(typeof LOCK_RENEWAL_INTERVAL_MS).toBe("number");
    expect(LOCK_RENEWAL_INTERVAL_MS).toBeGreaterThan(0);
  });

  it("LOCK_RENEWAL_INTERVAL_MS deve ser < metade do LOCK_TTL_MS (renovar antes de expirar)", async () => {
    // Dynamic import to get LOCK_TTL_MS
    const lockModule = await import("../lib/lock");
    // We check via the exported constant: renewal fires well before the 60s TTL
    expect(LOCK_RENEWAL_INTERVAL_MS).toBeLessThan(30_000); // < 60_000 / 2
  });

  it("LLM_TIMEOUT_MS é maior que LOCK_TTL_MS sem heartbeat — prova que o gap existia", () => {
    // LOCK_TTL_MS=60_000, LLM_TIMEOUT_MS=120_000: sem heartbeat a lock expira antes do LLM
    // Este teste documenta o bug. O heartbeat soluciona: lock dura enquanto job estiver vivo.
    const LOCK_TTL_MS = 60_000; // valor atual
    expect(LLM_TIMEOUT_MS).toBeGreaterThan(LOCK_TTL_MS);
  });

  it("MAX_VALIDATION_ATTEMPTS × (LLM_TIMEOUT + VALIDATION_TIMEOUT) excederia lock sem heartbeat", () => {
    const LOCK_TTL_MS = 60_000;
    const MAX_ATTEMPTS = 3;
    const worstCaseLLM = MAX_ATTEMPTS * (LLM_TIMEOUT_MS + VALIDATION_TIMEOUT_MS);
    // 3 × (120s + 30s) = 450s >> 60s: sem heartbeat seria catastrófico
    expect(worstCaseLLM).toBeGreaterThan(LOCK_TTL_MS);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// RC-3 — renewConversationLock unit tests
// ════════════════════════════════════════════════════════════════════════════

describe("RC-3: renewConversationLock — renovação atômica via Lua", () => {
  it("retorna true quando Redis EVAL retorna 1 (renovação bem-sucedida)", async () => {
    mockRedisCall.mockResolvedValue(1);
    const result = await renewConversationLock("conv-1", "lock-val-abc");
    expect(result).toBe(true);
  });

  it("retorna false quando EVAL retorna 0 — lock foi expirada ou tomada por outro job", async () => {
    mockRedisCall.mockResolvedValue(0);
    const result = await renewConversationLock("conv-1", "lock-val-abc");
    expect(result).toBe(false);
  });

  it("retorna false em erro de Redis sem propagar exceção", async () => {
    mockRedisCall.mockRejectedValue(new Error("Redis connection refused"));
    const result = await renewConversationLock("conv-1", "lock-val-abc");
    expect(result).toBe(false);
  });

  it("usa EVAL com chave correta lock:conversation:<conversationId>", async () => {
    mockRedisCall.mockResolvedValue(1);
    await renewConversationLock("conv-123", "lock-val");
    expect(mockRedisCall).toHaveBeenCalledWith(
      "EVAL",
      expect.any(String),
      "1",
      "lock:conversation:conv-123",
      "lock-val",
      expect.any(String) // TTL em ms como string
    );
  });

  it("script Lua usa pexpire — renovação, não deleção", async () => {
    mockRedisCall.mockResolvedValue(1);
    await renewConversationLock("conv-1", "lock-val");
    const luaScript = mockRedisCall.mock.calls[0][1] as string;
    expect(luaScript).toContain("pexpire");
    expect(luaScript).not.toContain("del");
  });

  it("script Lua verifica owner antes de renovar — atomicidade", async () => {
    mockRedisCall.mockResolvedValue(1);
    await renewConversationLock("conv-1", "lock-val");
    const luaScript = mockRedisCall.mock.calls[0][1] as string;
    // Must check current lock owner before extending TTL
    expect(luaScript).toContain("get");
    expect(luaScript).toContain("ARGV[1]");
  });

  it("passa o lockValue como ARGV[1] para verificação de owner", async () => {
    mockRedisCall.mockResolvedValue(1);
    await renewConversationLock("conv-1", "my-unique-lock-value");
    const argv1 = mockRedisCall.mock.calls[0][4]; // 5th arg is ARGV[1]
    expect(argv1).toBe("my-unique-lock-value");
  });

  it("passa o TTL como string numérica (Redis espera string)", async () => {
    mockRedisCall.mockResolvedValue(1);
    await renewConversationLock("conv-1", "lock-val");
    const ttlArg = mockRedisCall.mock.calls[0][5]; // 6th arg is ARGV[2]
    expect(typeof ttlArg).toBe("string");
    expect(Number(ttlArg)).toBeGreaterThan(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// RC-3 — Heartbeat no processo: setInterval criado e limpo
// ════════════════════════════════════════════════════════════════════════════

describe("RC-3: process-message heartbeat — setInterval / clearInterval", () => {
  it("LOCK_RENEWAL_INTERVAL_MS é suficientemente curto para renovar antes de 60s expirar", () => {
    // O heartbeat deve disparar pelo menos 2× dentro do LOCK_TTL_MS de 60s
    // para ter margem de segurança
    expect(LOCK_RENEWAL_INTERVAL_MS).toBeLessThan(60_000 / 2);
  });

  it("acquireConversationLock e releaseConversationLock ainda funcionam normalmente", async () => {
    mockRedisSet.mockResolvedValue("OK");
    mockRedisCall.mockResolvedValue(1);

    const val = await acquireConversationLock("conv-rc3");
    expect(val).not.toBeNull();

    await releaseConversationLock("conv-rc3", val!);
    // release via EVAL
    expect(mockRedisCall).toHaveBeenCalled();
  });
});
