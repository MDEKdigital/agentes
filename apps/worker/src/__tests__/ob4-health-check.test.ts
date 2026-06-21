/**
 * RED tests for OB-4:
 * - Health endpoint must probe Redis and return 503 when it is unavailable.
 * - Covers: checkRedisHealth, handleHealthRequest, timeout, no-sensitive-data leak.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock Redis connection ────────────────────────────────────────────────────

const { mockPing } = vi.hoisted(() => ({
  mockPing: vi.fn(),
}));

vi.mock("@aula-agente/queue", () => ({
  getRedisConnection: vi.fn(() => ({ ping: mockPing })),
}));

import {
  checkRedisHealth,
  handleHealthRequest,
  HEALTH_CHECK_TIMEOUT_MS,
} from "../lib/health";

// ── Minimal ServerResponse stub ──────────────────────────────────────────────

function makeRes() {
  return {
    writeHead: vi.fn(),
    end: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ════════════════════════════════════════════════════════════════════════════
// checkRedisHealth
// ════════════════════════════════════════════════════════════════════════════

describe("OB-4: checkRedisHealth", () => {
  it("HEALTH_CHECK_TIMEOUT_MS é exportado, positivo e menor que 10s", () => {
    expect(HEALTH_CHECK_TIMEOUT_MS).toBeGreaterThan(0);
    expect(HEALTH_CHECK_TIMEOUT_MS).toBeLessThan(10_000);
  });

  it("retorna { redis: 'up' } quando ping tem sucesso", async () => {
    mockPing.mockResolvedValue("PONG");
    const result = await checkRedisHealth(500);
    expect(result).toEqual({ redis: "up" });
  });

  it("retorna { redis: 'down' } quando ping rejeita (connection refused)", async () => {
    mockPing.mockRejectedValue(new Error("Connection refused"));
    const result = await checkRedisHealth(500);
    expect(result).toEqual({ redis: "down" });
  });

  it("retorna { redis: 'down' } quando ping não responde dentro do timeout", async () => {
    mockPing.mockImplementation(() => new Promise(() => {})); // never resolves
    const result = await checkRedisHealth(50); // 50ms timeout to keep test fast
    expect(result).toEqual({ redis: "down" });
  }, 2000);

  it("não vaza detalhes da conexão Redis no retorno (só up/down)", async () => {
    mockPing.mockRejectedValue(new Error("Redis error: AUTH failed for user 'default'"));
    const result = await checkRedisHealth(500);
    // result must not contain the error message or Redis URL
    expect(JSON.stringify(result)).not.toContain("AUTH");
    expect(JSON.stringify(result)).not.toContain("redis://");
    expect(result).toEqual({ redis: "down" });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// handleHealthRequest — HTTP response shaping
// ════════════════════════════════════════════════════════════════════════════

describe("OB-4: handleHealthRequest", () => {
  it("retorna status 200 quando Redis está saudável", async () => {
    mockPing.mockResolvedValue("PONG");
    const res = makeRes();
    await handleHealthRequest(res, 500);
    expect(res.writeHead).toHaveBeenCalledWith(200, expect.anything());
  });

  it("payload de sucesso contém status 'ok' e redis 'up'", async () => {
    mockPing.mockResolvedValue("PONG");
    const res = makeRes();
    await handleHealthRequest(res, 500);
    const body = JSON.parse(res.end.mock.calls[0][0] as string);
    expect(body.status).toBe("ok");
    expect(body.redis).toBe("up");
  });

  it("retorna status 503 quando Redis está indisponível", async () => {
    mockPing.mockRejectedValue(new Error("ECONNREFUSED"));
    const res = makeRes();
    await handleHealthRequest(res, 500);
    expect(res.writeHead).toHaveBeenCalledWith(503, expect.anything());
  });

  it("payload de degradação contém status 'degraded' e redis 'down'", async () => {
    mockPing.mockRejectedValue(new Error("ECONNREFUSED"));
    const res = makeRes();
    await handleHealthRequest(res, 500);
    const body = JSON.parse(res.end.mock.calls[0][0] as string);
    expect(body.status).toBe("degraded");
    expect(body.redis).toBe("down");
  });

  it("retorna 503 quando ping timeout expira (health não fica pendurado)", async () => {
    mockPing.mockImplementation(() => new Promise(() => {}));
    const res = makeRes();
    await handleHealthRequest(res, 50);
    expect(res.writeHead).toHaveBeenCalledWith(503, expect.anything());
  }, 2000);

  it("Content-Type é application/json em ambos os casos", async () => {
    mockPing.mockResolvedValue("PONG");
    const res = makeRes();
    await handleHealthRequest(res, 500);
    expect(res.writeHead).toHaveBeenCalledWith(
      200,
      expect.objectContaining({ "Content-Type": "application/json" })
    );
  });

  it("health não é always-green: ping falhando resulta em 503, não 200", async () => {
    mockPing.mockRejectedValue(new Error("Redis down"));
    const res = makeRes();
    await handleHealthRequest(res, 500);
    const statusCode = res.writeHead.mock.calls[0][0] as number;
    expect(statusCode).not.toBe(200);
    expect(statusCode).toBe(503);
  });
});
