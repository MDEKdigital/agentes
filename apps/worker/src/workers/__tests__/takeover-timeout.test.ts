import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockGetAdminClient,
  mockGetExpiredTakeovers,
  mockUpdateConversation,
  mockCreateAuditLog,
} = vi.hoisted(() => ({
  mockGetAdminClient: vi.fn().mockReturnValue({}),
  mockGetExpiredTakeovers: vi.fn().mockResolvedValue([]),
  mockUpdateConversation: vi.fn().mockResolvedValue({}),
  mockCreateAuditLog: vi.fn().mockResolvedValue({}),
}));

vi.mock("@aula-agente/database", () => ({
  getAdminClient: mockGetAdminClient,
  getExpiredTakeovers: mockGetExpiredTakeovers,
  updateConversation: mockUpdateConversation,
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

const CONV_1 = { id: "conv-1", organization_id: "org-1" };
const CONV_2 = { id: "conv-2", organization_id: "org-2" };

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAdminClient.mockReturnValue({});
  mockGetExpiredTakeovers.mockResolvedValue([]);
  mockUpdateConversation.mockResolvedValue({});
  mockCreateAuditLog.mockResolvedValue({});
});

describe("processTakeoverTimeouts", () => {
  it("não faz nada quando não há takeovers expirados", async () => {
    await processTakeoverTimeouts();
    expect(mockUpdateConversation).not.toHaveBeenCalled();
    expect(mockCreateAuditLog).not.toHaveBeenCalled();
  });

  it("libera takeover expirado e atualiza a conversa", async () => {
    mockGetExpiredTakeovers.mockResolvedValue([CONV_1]);
    await processTakeoverTimeouts();
    expect(mockUpdateConversation).toHaveBeenCalledWith(
      expect.anything(),
      "conv-1",
      { is_human_takeover: false, human_takeover_at: null },
      "org-1"
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

  it("(audit): NÃO audita quando updateConversation falha", async () => {
    mockGetExpiredTakeovers.mockResolvedValue([CONV_1]);
    mockUpdateConversation.mockRejectedValue(new Error("DB error"));
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
    expect(mockUpdateConversation).toHaveBeenCalledTimes(2);
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
});
