import { tool } from "ai";
import { z } from "zod";

export const CLOSE_CONVERSATION_TOOL_NAME = "close_conversation";

export function buildCloseConversationTool(_conversationId: string) {
  return tool({
    description:
      "Marca a conversa como resolvida e encerra o atendimento. " +
      "Use somente quando o cliente confirmar explicitamente que não precisa de mais ajuda.",
    parameters: z.object({}),
    execute: async () => ({ success: true }),
  });
}
