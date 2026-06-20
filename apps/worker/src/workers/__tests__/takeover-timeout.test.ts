import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockGetAdminClient,
  mockGetExpiredTakeovers,
  mockUpdateConversation,
  mockReleaseExpiredTakeover,
  mockCreateAuditLog,
} = vi.hoisted(() => ({
  mockGetAdminClient: vi.fn().mockReturnValue({}),
  mockGetExpiredTakeovers: vi.fn().mockResolvedValue([]),
  mockUpdateConversation: vi.fn().mockResolvedValue({}),
  mockReleaseExpiredTakeover: vi.fn().mockResolvedValue(true),
  mockCreateAuditLog: vi.fn().mockResolvedValue({}),
}));

vi.mock("@aula-agente/database", () => ({
  getAdminClient: mockGetAdminClient,
  getExpiredTakeovers: mockGetExpiredTakeovers,
  updateConversation: mockUpdateConversation,
  releaseExpiredTakeover: mockReleaseExpiredTakeover,
  createAuditLog: mockCreateAuditLog,
}));

vi.mock("@aula-agente/queue", () => ({
  getTakeoverTimeoutQueue: vi.fn().mockReturnValue({ upsertJobScheduler: vi.fn() }),
}));

vi.mock("bullmq", () => ({
  Worker: vi.fn().mockImplementation(() => ({ on: vi.fn() })),
}));

vi.mock("../../lib/redis", () => ({
  getConnectionOptions: vi.fn().mockReturnValue({}),
}));

import { processTakeoverTimeouts } from "../takeover-timeout";

const CONV_1 = { id: "conv-1", organization_id: "org-1", human_takeover_at: "2026-01-01T00:00:00.000Z" };
const CONV_2 = { id: "conv-2", organization_id: "org-2", human_takeover_at: "2026-01-02T00:00:00.000Z" };

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAdminClient.mockReturnValue({});
  mockGetExpiredTakeovers.mockResolvedValue([]);
  mockUpdateConversation.mockResolvedValue({});
  mockReleaseExpiredTakeover.mockResolvedValue(true);
  mockCreateAuditLog.mockResolvedValue({});
});

describe("processTakeoverTimeouts", () => {
  it("não faz nada quando não há takeovers expirados", async () => {
    await processTakeoverTimeouts();
    expect(mockUpdateConversation).not.toHaveBeenCalled();
    expect(mockCreateAuditLog).not.toHaveBeenCalled();
  });

  it("libera takeover expirado via releaseExpiredTakeover com o timestamp original", async () => {
    mockGetExpiredTakeovers.mockResolvedValue([CONV_1]);
    await processTakeoverTimeouts();
    expect(mockReleaseExpiredTakeover).toHaveBeenCalledWith(
      expect.anything(),
      "conv-1",
      "org-1",
      "2026-01-01T00:00:00.000Z"
    );
  });

  it("(audit): registra conversation.takeover_expired para cada conversa liberada", async () => {
    mockGetExpiredTakeovers.mockResolvedValue([CONV_1]);
    await processTakeoverTimeouts();
    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "conversation.takeover_expired",
        entity_type: "conversation",
        entity_id: "conv-1",
        organization_id: "org-1",
      })
    );
  });

  it("(audit): NÃO audita quando releaseExpiredTakeover falha com erro", async () => {
    mockGetExpiredTakeovers.mockResolvedValue([CONV_1]);
    mockReleaseExpiredTakeover.mockRejectedValue(new Error("DB error"));
    await processTakeoverTimeouts();
    expect(mockCreateAuditLog).not.toHaveBeenCalled();
  });

  it("R14: conversation.takeover_expired carrega actor=system no metadata", async () => {
    mockGetExpiredTakeovers.mockResolvedValue([CONV_1]);
    await processTakeoverTimeouts();
    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "conversation.takeover_expired",
        metadata: expect.objectContaining({ actor: "system" }),
      })
    );
  });

  it("processa múltiplas conversas expiradas e audita cada uma", async () => {
    mockGetExpiredTakeovers.mockResolvedValue([CONV_1, CONV_2]);
    await processTakeoverTimeouts();
    expect(mockReleaseExpiredTakeover).toHaveBeenCalledTimes(2);
    expect(mockCreateAuditLog).toHaveBeenCalledTimes(2);
    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ entity_id: "conv-1" })
    );
    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ entity_id: "conv-2" })
    );
  });

  // C9 — RED: takeover re-ativado manualmente não deve ser sobrescrito pelo worker
  it("C9: NÃO sobrescreve takeover quando human_takeover_at mudou entre leitura e update", async () => {
    mockGetExpiredTakeovers.mockResolvedValue([CONV_1]);
    // Simula: takeover foi re-ativado manualmente antes do update do worker
    // releaseExpiredTakeover retorna false = nenhuma linha atualizada (timestamp não bateu)
    mockReleaseExpiredTakeover.mockResolvedValue(false);

    await processTakeoverTimeouts();

    // O worker deve chamar releaseExpiredTakeover com o timestamp original lido
    expect(mockReleaseExpiredTakeover).toHaveBeenCalledWith(
      expect.anything(),
      "conv-1",
      "org-1",
      "2026-01-01T00:00:00.000Z"
    );
    // Nenhuma linha foi sobrescrita — o takeover manual é preservado
  });

  it("C9: audit NÃO dispara quando a liberação não ocorreu (timestamp mudou — falso sucesso prevenido)", async () => {
    mockGetExpiredTakeovers.mockResolvedValue([CONV_1]);
    // worker lê conversa expirada, mas agente re-ativa antes do update
    mockReleaseExpiredTakeover.mockResolvedValue(false);

    await processTakeoverTimeouts();

    // Não deve auditar pois a liberação NÃO ocorreu de fato
    expect(mockCreateAuditLog).not.toHaveBeenCalled();
  });

  it("C9: libera normalmente e audita quando human_takeover_at não mudou", async () => {
    mockGetExpiredTakeovers.mockResolvedValue([CONV_1]);
    mockReleaseExpiredTakeover.mockResolvedValue(true); // timestamp bateu, linha atualizada

    await processTakeoverTimeouts();

    expect(mockReleaseExpiredTakeover).toHaveBeenCalledOnce();
    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "conversation.takeover_expired",
        entity_id: "conv-1",
      })
    );
  });
});
