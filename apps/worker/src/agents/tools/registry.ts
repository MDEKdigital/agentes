import type { ToolsConfig } from "@aula-agente/shared";
import { createSearchKnowledgeTool } from "./search-knowledge";
import { createSearchFaqTool } from "./search-faq";
import { buildCloseConversationTool } from "./close-conversation";

interface RegistryParams {
  organizationId: string;
  agentId: string;
  toolsConfig: ToolsConfig;
  apiKey: string;
  conversationId: string;
}

export function buildToolsForAgent(params: RegistryParams) {
  const { organizationId, agentId, toolsConfig, apiKey, conversationId } = params;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tools: Record<string, any> = {};

  if (toolsConfig.search_knowledge) {
    tools.searchKnowledge = createSearchKnowledgeTool(organizationId, agentId, apiKey);
  }

  if (toolsConfig.search_faq) {
    tools.searchFaq = createSearchFaqTool(agentId, organizationId);
  }

  tools.close_conversation = buildCloseConversationTool(conversationId);

  return tools;
}
