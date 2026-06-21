import { describe, it, expect } from "vitest";
import { buildCloseConversationTool, CLOSE_CONVERSATION_TOOL_NAME } from "../close-conversation";

function makeContactMessage(content: string) {
  return {
    id: "msg-1",
    conversation_id: "conv-1",
    organization_id: "org-1",
    evolution_message_id: null,
    role: "contact" as const,
    content,
    media_url: null,
    media_type: null,
    metadata: {},
    created_at: "",
  };
}

describe("buildCloseConversationTool", () => {
  it("retorna no_user_confirmation quando não há confirmação no histórico", async () => {
    const tool = buildCloseConversationTool("conv-1", [
      makeContactMessage("Olá, tenho uma dúvida"),
    ]);
    const result = await tool.execute({}, { messages: [], toolCallId: "tc-1" });
    expect(result).toEqual({ success: false, reason: "no_user_confirmation" });
  });

  it("retorna { success: true } quando mensagem recente contém keyword de confirmação", async () => {
    const tool = buildCloseConversationTool("conv-1", [
      makeContactMessage("obrigado, resolveu meu problema!"),
    ]);
    const result = await tool.execute({}, { messages: [], toolCallId: "tc-1" });
    expect(result).toEqual({ success: true });
  });

  it("retorna no_user_confirmation quando chamado sem mensagens (default [])", async () => {
    const tool = buildCloseConversationTool("conv-1");
    const result = await tool.execute({}, { messages: [], toolCallId: "tc-1" });
    expect(result).toEqual({ success: false, reason: "no_user_confirmation" });
  });

  it("CLOSE_CONVERSATION_TOOL_NAME é 'close_conversation'", () => {
    expect(CLOSE_CONVERSATION_TOOL_NAME).toBe("close_conversation");
  });
});
