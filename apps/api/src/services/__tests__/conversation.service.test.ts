import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockFindOpenConversation,
  mockUpdateConversation,
  mockCreateConversation,
  mockUpsertContact,
} = vi.hoisted(() => ({
  mockFindOpenConversation: vi.fn(),
  mockUpdateConversation: vi.fn(),
  mockCreateConversation: vi.fn(),
  mockUpsertContact: vi.fn(),
}));

vi.mock("@aula-agente/database", () => ({
  getAdminClient: vi.fn(() => ({})),
  findOpenConversation: mockFindOpenConversation,
  updateConversation: mockUpdateConversation,
  createConversation: mockCreateConversation,
  upsertContact: mockUpsertContact,
}));

import { ensureConversation } from "../conversation.service";

const baseParams = {
  organizationId: "org-1",
  agentId: "agent-1",
  instanceId: "inst-1",
  phone: "5511999999999",
  contactName: "João",
  contactPhotoUrl: null,
};

const contact = { id: "contact-1", phone: "5511999999999" };

beforeEach(() => {
  vi.clearAllMocks();
  mockUpsertContact.mockResolvedValue(contact);
});

describe("ensureConversation", () => {
  it("retorna conversa 'open' existente sem modificar", async () => {
    const openConv = { id: "conv-1", status: "open" };
    mockFindOpenConversation.mockResolvedValue(openConv);

    const result = await ensureConversation(baseParams);

    expect(result.conversation).toEqual(openConv);
    expect(result.isNew).toBe(false);
    expect(mockUpdateConversation).not.toHaveBeenCalled();
    expect(mockCreateConversation).not.toHaveBeenCalled();
  });

  it("retorna conversa 'waiting' existente sem modificar", async () => {
    const waitingConv = { id: "conv-1", status: "waiting" };
    mockFindOpenConversation.mockResolvedValue(waitingConv);

    const result = await ensureConversation(baseParams);

    expect(result.conversation).toEqual(waitingConv);
    expect(mockUpdateConversation).not.toHaveBeenCalled();
  });

  it("reativa conversa 'resolved' para 'open' em vez de criar nova", async () => {
    const resolvedConv = { id: "conv-resolved", status: "resolved" };
    const reopenedConv = { id: "conv-resolved", status: "open" };
    mockFindOpenConversation.mockResolvedValue(resolvedConv);
    mockUpdateConversation.mockResolvedValue(reopenedConv);

    const result = await ensureConversation(baseParams);

    expect(mockUpdateConversation).toHaveBeenCalledWith(
      expect.anything(),
      "conv-resolved",
      { status: "open" }
    );
    expect(result.conversation).toEqual(reopenedConv);
    expect(result.isNew).toBe(false);
    expect(mockCreateConversation).not.toHaveBeenCalled();
  });

  it("cria nova conversa quando não existe nenhuma", async () => {
    mockFindOpenConversation.mockResolvedValue(null);
    const newConv = { id: "conv-new", status: "open" };
    mockCreateConversation.mockResolvedValue(newConv);

    const result = await ensureConversation(baseParams);

    expect(mockCreateConversation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organization_id: "org-1",
        agent_id: "agent-1",
        status: "open",
      })
    );
    expect(result.isNew).toBe(true);
  });
});
