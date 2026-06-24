import { tool } from "ai";
import { z } from "zod";

export const HUMAN_HANDOFF_TOOL_NAME = "request_human_handoff";

export function buildRequestHumanHandoffTool() {
  return tool({
    description:
      "Transfere o atendimento para um atendente humano. " +
      "Use quando o cliente solicitar explicitamente falar com uma pessoa real, " +
      "ou quando o pedido estiver completamente fora do seu escopo.",
    parameters: z.object({}),
    execute: async () => ({ success: true }),
  });
}
