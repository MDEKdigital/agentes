import { describe, it, expect } from "vitest";
import { buildCloseConversationTool, CLOSE_CONVERSATION_TOOL_NAME } from "../close-conversation";

describe("buildCloseConversationTool", () => {
  it("retorna { success: true } ao executar sem escrever no banco", async () => {
    const tool = buildCloseConversationTool("conv-1");
    const result = await tool.execute({}, { messages: [], toolCallId: "tc-1" });
    expect(result).toEqual({ success: true });
  });

  it("CLOSE_CONVERSATION_TOOL_NAME é 'close_conversation'", () => {
    expect(CLOSE_CONVERSATION_TOOL_NAME).toBe("close_conversation");
  });
});
