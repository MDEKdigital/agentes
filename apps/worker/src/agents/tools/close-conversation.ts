import { tool } from "ai";
import { z } from "zod";
import type { Message } from "@aula-agente/shared";

export const CLOSE_CONVERSATION_TOOL_NAME = "close_conversation";

const CONFIRMATION_KEYWORDS = [
  "obrigado",
  "obrigada",
  "valeu",
  "era só isso",
  "tudo certo",
  "resolveu",
  "já comprei",
  "pode encerrar",
  "não tenho mais dúvidas",
  "pode fechar",
  "pode finalizar",
];

function hasUserConfirmation(messages: Message[]): boolean {
  const recentContact = messages
    .filter((m) => m.role === "contact")
    .slice(-3)
    .map((m) => m.content.toLowerCase());

  return recentContact.some((content) =>
    CONFIRMATION_KEYWORDS.some((kw) => content.includes(kw))
  );
}

export function buildCloseConversationTool(
  _conversationId: string,
  messages: Message[] = [],
) {
  return tool({
    description:
      "Marca a conversa como resolvida e encerra o atendimento. " +
      "Use somente quando o cliente confirmar explicitamente que não precisa de mais ajuda.",
    parameters: z.object({}),
    execute: async () => {
      if (!hasUserConfirmation(messages)) {
        return { success: false, reason: "no_user_confirmation" };
      }
      return { success: true };
    },
  });
}
