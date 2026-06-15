import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockUpdateConversation } = vi.hoisted(() => ({
  mockUpdateConversation: vi.fn(),
}));

vi.mock("@aula-agente/database", () => ({
  getAdminClient: vi.fn(() => ({})),
  updateConversation: mockUpdateConversation,
}));

import { buildCloseConversationTool } from "../close-conversation";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("buildCloseConversationTool", () => {
  it("chama updateConversation com status resolved ao executar", async () => {
    mockUpdateConversation.mockResolvedValue({ id: "conv-1", status: "resolved" });
    const tool = buildCloseConversationTool("conv-1");
    const result = await tool.execute({}, { messages: [], toolCallId: "tc-1" });
    expect(mockUpdateConversation).toHaveBeenCalledWith(
      expect.anything(),
      "conv-1",
      { status: "resolved" }
    );
    expect(result).toEqual({ success: true });
  });

  it("usa o conversationId passado via closure, não hardcoded", async () => {
    mockUpdateConversation.mockResolvedValue({ id: "conv-abc", status: "resolved" });
    const tool = buildCloseConversationTool("conv-abc");
    await tool.execute({}, { messages: [], toolCallId: "tc-2" });
    expect(mockUpdateConversation).toHaveBeenCalledWith(
      expect.anything(),
      "conv-abc",
      { status: "resolved" }
    );
  });
});
