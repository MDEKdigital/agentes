import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";

const { mockGetInstanceById, mockRequestPairingCode, mockAuthMiddleware } = vi.hoisted(() => ({
  mockGetInstanceById: vi.fn(),
  mockRequestPairingCode: vi.fn(),
  mockAuthMiddleware: vi.fn(async (request: { user: unknown }) => {
    request.user = {
      memberships: [{ organization_id: "org-1", role: "admin" }],
    };
  }),
}));

vi.mock("@aula-agente/database", () => ({
  getAdminClient: vi.fn(() => ({})),
  getInstanceById: mockGetInstanceById,
}));

vi.mock("../../../services/evolution.service", () => ({
  requestPairingCode: mockRequestPairingCode,
}));

vi.mock("../../../middleware/auth", () => ({
  authMiddleware: mockAuthMiddleware,
}));

import instanceRoutes from "../index";

const mockInstance = {
  id: "inst-1",
  organization_id: "org-1",
  instance_name: "test-instance",
  status: "disconnected",
  phone_number: null,
};

async function buildApp() {
  const app = Fastify();
  await app.register(instanceRoutes);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /instances/:instanceId/pairing-code", () => {
  it("retorna código quando número válido (11 dígitos)", async () => {
    mockGetInstanceById.mockResolvedValue(mockInstance as never);
    mockRequestPairingCode.mockResolvedValue({ pairingCode: "ABCD-EFGH" });

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/instances/inst-1/pairing-code",
      payload: { phone_number: "11999999999" },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ code: "ABCD-EFGH" });
    expect(mockRequestPairingCode).toHaveBeenCalledWith("test-instance", "5511999999999");
  });

  it("retorna código quando número válido (10 dígitos)", async () => {
    mockGetInstanceById.mockResolvedValue(mockInstance as never);
    mockRequestPairingCode.mockResolvedValue({ pairingCode: "WXYZ-1234" });

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/instances/inst-1/pairing-code",
      payload: { phone_number: "1199999999" },
    });

    expect(res.statusCode).toBe(200);
    expect(mockRequestPairingCode).toHaveBeenCalledWith("test-instance", "551199999999");
  });

  it("retorna 400 quando número tem menos de 10 dígitos", async () => {
    mockGetInstanceById.mockResolvedValue(mockInstance as never);

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/instances/inst-1/pairing-code",
      payload: { phone_number: "119999" },
    });

    expect(res.statusCode).toBe(400);
  });

  it("retorna 400 quando número contém letras", async () => {
    mockGetInstanceById.mockResolvedValue(mockInstance as never);

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/instances/inst-1/pairing-code",
      payload: { phone_number: "1199999abc" },
    });

    expect(res.statusCode).toBe(400);
  });

  it("retorna 400 quando número tem mais de 11 dígitos", async () => {
    mockGetInstanceById.mockResolvedValue(mockInstance as never);

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/instances/inst-1/pairing-code",
      payload: { phone_number: "119999999991" },
    });

    expect(res.statusCode).toBe(400);
  });

  it("retorna 404 quando instância não existe", async () => {
    mockGetInstanceById.mockRejectedValue({ code: "PGRST116" });

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/instances/inst-99/pairing-code",
      payload: { phone_number: "11999999999" },
    });

    expect(res.statusCode).toBe(404);
  });

  it("retorna 500 quando requestPairingCode falha na Evolution API", async () => {
    mockGetInstanceById.mockResolvedValue(mockInstance);
    mockRequestPairingCode.mockRejectedValue(new Error("Evolution down"));

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/instances/inst-1/pairing-code",
      payload: { phone_number: "11999999999" },
    });

    expect(res.statusCode).toBe(500);
  });

  it("(S8) usuário não é membro da org da instância → 404 (anti-enumeração)", async () => {
    mockAuthMiddleware.mockImplementationOnce(async (request: { user: unknown }) => {
      request.user = {
        memberships: [{ organization_id: "other-org", role: "admin" }],
      };
    });
    mockGetInstanceById.mockResolvedValue(mockInstance);

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/instances/inst-1/pairing-code",
      payload: { phone_number: "11999999999" },
    });

    expect(res.statusCode).toBe(404);
  });
});
