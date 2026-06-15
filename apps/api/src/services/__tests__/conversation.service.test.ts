import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockFindReopenableConversation,
  mockReopenConversation,
  mockCreateConversation,
  mockUpsertContact,
} = vi.hoisted(() => ({
  mockFindReopenableConversation: vi.fn(),
  mockReopenConversation: vi.fn(),
  mockCreateConversation: vi.fn(),
  mockUpsertContact: vi.fn(),
}));

vi.mock("@aula-agente/database", () => ({
  getAdminClient: vi.fn(() => ({})),
  findReopenableConversation: mockFindReopenableConversation,
  reopenConversation: mockReopenConversation,
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
    mockFindReopenableConversation.mockResolvedValue(openConv);

    const result = await ensureConversation(baseParams);

    expect(result.conversation).toEqual(openConv);
    expect(result.isNew).toBe(false);
    expect(mockReopenConversation).not.toHaveBeenCalled();
    expect(mockCreateConversation).not.toHaveBeenCalled();
  });

  it("retorna conversa 'waiting' existente sem modificar", async () => {
    const waitingConv = { id: "conv-1", status: "waiting" };
    mockFindReopenableConversation.mockResolvedValue(waitingConv);

    const result = await ensureConversation(baseParams);

    expect(result.conversation).toEqual(waitingConv);
    expect(mockReopenConversation).not.toHaveBeenCalled();
  });

  it("reativa conversa 'resolved' via reopenConversation em vez de criar nova", async () => {
    const resolvedConv = { id: "conv-resolved", status: "resolved" };
    const reopenedConv = { id: "conv-resolved", status: "open" };
    mockFindReopenableConversation.mockResolvedValue(resolvedConv);
    mockReopenConversation.mockResolvedValue(reopenedConv);

    const result = await ensureConversation(baseParams);

    expect(mockReopenConversation).toHaveBeenCalledWith(expect.anything(), "conv-resolved");
    expect(result.conversation).toEqual(reopenedConv);
    expect(result.isNew).toBe(false);
    expect(mockCreateConversation).not.toHaveBeenCalled();
  });

  it("cria nova conversa quando não existe nenhuma", async () => {
    mockFindReopenableConversation.mockResolvedValue(null);
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
