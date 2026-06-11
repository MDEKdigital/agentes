import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";

vi.mock("@aula-agente/database", () => ({
  getAdminClient: vi.fn(() => ({})),
  getInstanceById: vi.fn(),
}));

vi.mock("../../../services/evolution.service", () => ({
  requestPairingCode: vi.fn(),
}));

vi.mock("../../../middleware/auth", () => ({
  authMiddleware: vi.fn(async (request: { user: unknown }) => {
    request.user = {
      memberships: [{ organization_id: "org-1", role: "admin" }],
    };
  }),
}));

import { getInstanceById } from "@aula-agente/database";
import { requestPairingCode } from "../../../services/evolution.service";
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
    vi.mocked(getInstanceById).mockResolvedValue(mockInstance as never);
    vi.mocked(requestPairingCode).mockResolvedValue({ code: "ABCD-EFGH" });

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/instances/inst-1/pairing-code",
      payload: { phone_number: "11999999999" },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ code: "ABCD-EFGH" });
    expect(requestPairingCode).toHaveBeenCalledWith("test-instance", "5511999999999");
  });

  it("retorna código quando número válido (10 dígitos)", async () => {
    vi.mocked(getInstanceById).mockResolvedValue(mockInstance as never);
    vi.mocked(requestPairingCode).mockResolvedValue({ code: "WXYZ-1234" });

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/instances/inst-1/pairing-code",
      payload: { phone_number: "1199999999" },
    });

    expect(res.statusCode).toBe(200);
    expect(requestPairingCode).toHaveBeenCalledWith("test-instance", "551199999999");
  });

  it("retorna 400 quando número tem menos de 10 dígitos", async () => {
    vi.mocked(getInstanceById).mockResolvedValue(mockInstance as never);

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/instances/inst-1/pairing-code",
      payload: { phone_number: "119999" },
    });

    expect(res.statusCode).toBe(400);
  });

  it("retorna 400 quando número contém letras", async () => {
    vi.mocked(getInstanceById).mockResolvedValue(mockInstance as never);

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/instances/inst-1/pairing-code",
      payload: { phone_number: "1199999abc" },
    });

    expect(res.statusCode).toBe(400);
  });

  it("retorna 400 quando número tem mais de 11 dígitos", async () => {
    vi.mocked(getInstanceById).mockResolvedValue(mockInstance as never);

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/instances/inst-1/pairing-code",
      payload: { phone_number: "119999999991" },
    });

    expect(res.statusCode).toBe(400);
  });

  it("retorna 404 quando instância não existe", async () => {
    vi.mocked(getInstanceById).mockRejectedValue({ code: "PGRST116" });

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/instances/inst-99/pairing-code",
      payload: { phone_number: "11999999999" },
    });

    expect(res.statusCode).toBe(404);
  });
});
