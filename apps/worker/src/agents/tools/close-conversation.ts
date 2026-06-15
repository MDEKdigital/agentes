import { tool } from "ai";
import { z } from "zod";
import { getAdminClient, updateConversation } from "@aula-agente/database";

export function buildCloseConversationTool(conversationId: string) {
  return tool({
    description:
      "Marca a conversa como resolvida e encerra o atendimento. " +
      "Use somente quando o cliente confirmar explicitamente que não precisa de mais ajuda.",
    parameters: z.object({}),
    execute: async () => {
      const db = getAdminClient();
      await updateConversation(db, conversationId, { status: "resolved" });
      return { success: true };
    },
  });
}
