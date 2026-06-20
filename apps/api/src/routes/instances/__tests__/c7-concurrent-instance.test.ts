/**
 * C7 — TOCTOU bypass de limite de instâncias em criações concorrentes
 *
 * O padrão read→check→write permite que duas requests simultâneas passem pelo
 * checkResourceLimit e ambas criem instâncias (incluindo chamada externa à Evolution API).
 *
 * Fix: substituir createInstanceRecord + checkResourceLimit como gate por
 * createInstanceAtomically (check+insert em operação única).
 * Side effect externo (createEvolutionInstance) SÓ ocorre após reserva atômica do slot.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";

const {
  mockAuthMiddleware,
  mockGetAdminClient,
  mockCreateInstanceAtomically,
  mockCreateInstanceRecord,
  mockUpdateInstance,
  mockCheckResourceLimit,
  mockCreateEvolutionInstance,
  mockCreateAuditLog,
} = vi.hoisted(() => ({
  mockAuthMiddleware: vi.fn(),
  mockGetAdminClient: vi.fn(() => ({})),
  mockCreateInstanceAtomically: vi.fn(),
  mockCreateInstanceRecord: vi.fn(),
  mockUpdateInstance: vi.fn(),
  mockCheckResourceLimit: vi.fn(),
  mockCreateEvolutionInstance: vi.fn(),
  mockCreateAuditLog: vi.fn().mockResolvedValue({}),
}));

vi.mock("../../../middleware/auth", () => ({ authMiddleware: mockAuthMiddleware }));

vi.mock("@aula-agente/database", () => ({
  getAdminClient: mockGetAdminClient,
  getInstancesByOrganization: vi.fn(),
  getInstanceByIdForUser: vi.fn(),
  createInstance: mockCreateInstanceRecord,
  createInstanceAtomically: mockCreateInstanceAtomically,
  updateInstance: mockUpdateInstance,
  deleteInstance: vi.fn(),
  checkResourceLimit: mockCheckResourceLimit,
  getAgentById: vi.fn(),
  createAuditLog: mockCreateAuditLog,
}));

vi.mock("../../../services/evolution.service", () => ({
  createInstance: mockCreateEvolutionInstance,
  getInstanceStatus: vi.fn(),
  getInstanceQrCode: vi.fn(),
  deleteInstance: vi.fn(),
  logoutInstance: vi.fn(),
  fetchProfile: vi.fn(),
  fetchInstanceDetails: vi.fn(),
  updateProfileName: vi.fn(),
  updateProfileStatus: vi.fn(),
  updateProfilePicture: vi.fn(),
  getInstanceSettings: vi.fn(),
  setInstanceSettings: vi.fn(),
  getPrivacySettings: vi.fn(),
  updatePrivacySettings: vi.fn(),
  restartInstance: vi.fn(),
  requestPairingCode: vi.fn(),
}));

import instanceRoutes from "../index";

const ORG_ID  = "org-c7-uuid";
const USER_ID = "user-c7-uuid";

const PENDING_INSTANCE = {
  id: "inst-c7-uuid",
  organization_id: ORG_ID,
  instance_name: "whatsapp-c7",
  instance_id: "whatsapp-c7",
  webhook_url: "https://api.example.com/webhooks/evolution",
  status: "connecting",
  phone_number: null,
};

const FINAL_INSTANCE = { ...PENDING_INSTANCE, status: "disconnected" };

async function buildApp() {
  mockAuthMiddleware.mockImplementation(async (request: any) => {
    request.user = { id: USER_ID, memberships: [{ organization_id: ORG_ID, role: "admin" }] };
  });
  const app = Fastify({ logger: false });
  await app.register(instanceRoutes);
  return app;
}

async function postInstance(app: Awaited<ReturnType<typeof buildApp>>, name = "whatsapp-c7") {
  return app.inject({
    method: "POST",
    url: `/organizations/${ORG_ID}/instances`,
    payload: { instance_name: name },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCheckResourceLimit.mockResolvedValue({ allowed: true, current: 1, max: 3 });
  mockCreateInstanceAtomically.mockResolvedValue(PENDING_INSTANCE);
  mockCreateInstanceRecord.mockResolvedValue(PENDING_INSTANCE);
  mockUpdateInstance.mockResolvedValue(FINAL_INSTANCE);
  mockCreateEvolutionInstance.mockResolvedValue({ instance: { instanceName: "whatsapp-c7" } });
});

// ── C7 tests ─────────────────────────────────────────────────────────────────

describe("C7 — instância atômica com guarda de limite (POST /organizations/:id/instances)", () => {

  // 1. Rota usa createInstanceAtomically (não createInstanceRecord direto)
  it("C7: rota chama createInstanceAtomically em vez de createInstance diretamente", async () => {
    const app = await buildApp();
    await postInstance(app);

    // RED: current route calls createInstance (createInstanceRecord) directly
    expect(mockCreateInstanceAtomically).toHaveBeenCalledOnce();
  });

  // 2. createInstanceRecord (helper antigo) NÃO é chamado
  it("C7: createInstance (sem guarda atômica) NÃO é chamado diretamente", async () => {
    const app = await buildApp();
    await postInstance(app);

    // RED: current code calls createInstance directly
    expect(mockCreateInstanceRecord).not.toHaveBeenCalled();
  });

  // 3. Reserva atômica falha (null) → 403, createEvolutionInstance NÃO chamado
  it("C7: slot não disponível — helper retorna null → 403 e Evolution API NÃO chamada", async () => {
    mockCreateInstanceAtomically.mockResolvedValue(null);
    const app = await buildApp();
    const res = await postInstance(app);

    // RED: current code would still try to insert and might call Evolution API
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ limit_exceeded: true });
    expect(mockCreateEvolutionInstance).not.toHaveBeenCalled();
  });

  // 4. Reserva atômica falha → audit NÃO dispara
  it("C7: slot não disponível → audit instance.created NÃO dispara", async () => {
    mockCreateInstanceAtomically.mockResolvedValue(null);
    const app = await buildApp();
    await postInstance(app);

    expect(mockCreateAuditLog).not.toHaveBeenCalled();
  });

  // 5. Simulação de concorrência: primeiro slot disponível, segundo não
  it("C7: concorrência — primeiro request reserva slot, segundo retorna null → segunda falha 403", async () => {
    const app = await buildApp();
    mockCreateInstanceAtomically.mockResolvedValueOnce(PENDING_INSTANCE);
    const res1 = await postInstance(app, "inst-a");

    mockCreateInstanceAtomically.mockResolvedValueOnce(null);
    const res2 = await postInstance(app, "inst-b");

    expect(res1.statusCode).toBe(201);
    expect(res2.statusCode).toBe(403);
    expect(mockCreateEvolutionInstance).toHaveBeenCalledTimes(1); // only for first request
  });

  // 6. Fluxo nominal: slot reservado → Evolution API chamada → 201
  it("C7: fluxo nominal — reserva atômica bem-sucedida → Evolution API chamada → 201", async () => {
    const app = await buildApp();
    const res = await postInstance(app);

    expect(res.statusCode).toBe(201);
    expect(mockCreateEvolutionInstance).toHaveBeenCalledOnce();
  });

  // 7. Fluxo nominal: createInstanceAtomically recebe dados corretos (DB-first)
  it("C7: createInstanceAtomically recebe instance_name, status 'connecting' e org correta", async () => {
    const app = await buildApp();
    await postInstance(app);

    expect(mockCreateInstanceAtomically).toHaveBeenCalledWith(
      expect.anything(),
      ORG_ID,
      expect.objectContaining({
        instance_name: "whatsapp-c7",
        status: "connecting",
      })
    );
  });

  // 8. checkResourceLimit ainda funciona como pré-check rápido
  it("regressão: limite já ultrapassado (checkResourceLimit=false) → 403 imediato sem helper atômico", async () => {
    mockCheckResourceLimit.mockResolvedValue({ allowed: false, current: 3, max: 3 });
    const app = await buildApp();
    const res = await postInstance(app);

    expect(res.statusCode).toBe(403);
    expect(mockCreateInstanceAtomically).not.toHaveBeenCalled();
    expect(mockCreateEvolutionInstance).not.toHaveBeenCalled();
  });

  // 9. Evolution API falha após reserva atômica → 502 (DB-first preservado)
  it("regressão: Evolution API falha após reserva → 502 (instância fica em connecting)", async () => {
    mockCreateEvolutionInstance.mockRejectedValue(new Error("Evolution down"));
    const app = await buildApp();
    const res = await postInstance(app);

    // slot was reserved (instance in DB), Evolution failed → 502
    expect(res.statusCode).toBe(502);
    expect(mockCreateInstanceAtomically).toHaveBeenCalledOnce(); // slot reserved
    expect(mockCreateEvolutionInstance).toHaveBeenCalledOnce(); // attempted
  });

  // 10. Audit dispara quando criação completa com sucesso
  it("regressão: audit instance.created dispara quando instância criada com sucesso", async () => {
    const app = await buildApp();
    await postInstance(app);

    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "instance.created", organization_id: ORG_ID })
    );
  });
});
