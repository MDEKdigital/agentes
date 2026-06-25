import type { ToolsConfig, Message } from "@aula-agente/shared";
import { createSearchKnowledgeTool } from "./search-knowledge";
import { createSearchFaqTool } from "./search-faq";
import { createSearchWebTool } from "./search-web";
import { createSearchProductsTool } from "./search-products";
import { buildCloseConversationTool, CLOSE_CONVERSATION_TOOL_NAME } from "./close-conversation";
import { buildRequestHumanHandoffTool, HUMAN_HANDOFF_TOOL_NAME } from "./request-human-handoff";

export { HUMAN_HANDOFF_TOOL_NAME };

interface RegistryParams {
  organizationId: string;
  agentId: string;
  toolsConfig: ToolsConfig;
  apiKey: string;
  conversationId: string;
  messages: Message[];
  currentMessage: Message;
}

export function buildToolsForAgent(params: RegistryParams) {
  const { organizationId, agentId, toolsConfig, apiKey, conversationId, messages, currentMessage } = params;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tools: Record<string, any> = {};

  if (toolsConfig.search_knowledge) {
    tools.searchKnowledge = createSearchKnowledgeTool(organizationId, agentId, apiKey);
  }

  if (toolsConfig.search_faq) {
    tools.searchFaq = createSearchFaqTool(agentId, organizationId);
  }

  if (toolsConfig.search_web) {
    tools.searchWeb = createSearchWebTool();
  }

  if (toolsConfig.search_products) {
    tools.searchProducts = createSearchProductsTool(organizationId);
  }

  tools[CLOSE_CONVERSATION_TOOL_NAME] = buildCloseConversationTool(
    conversationId,
    [...messages, currentMessage],
  );

  tools[HUMAN_HANDOFF_TOOL_NAME] = buildRequestHumanHandoffTool();

  return tools;
}
