import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { Agent, LLMProvider, Message } from "@aula-agente/shared";
import { buildToolsForAgent } from "./tools/registry";

interface RunAgentParams {
  agent: Agent;
  messages: Message[];
  currentMessage: Message;
  apiKey: string;
  organizationId: string;
}

interface RunAgentResult {
  text: string;
  model: string;
  tokensUsed: number;
  latencyMs: number;
  toolCalls: string[];
}

interface ValidationResult {
  compliant: boolean;
  violation?: string;
}

const VALIDATION_MODELS: Record<LLMProvider, string> = {
  openai: "gpt-4.1-nano",
  anthropic: "claude-haiku-4-20250414",
  google: "gemini-2.0-flash-lite",
};

const MAX_ATTEMPTS = 3;

function createModel(provider: LLMProvider, modelName: string, apiKey: string) {
  switch (provider) {
    case "openai": {
      const openai = createOpenAI({ apiKey });
      return openai(modelName);
    }
    case "anthropic": {
      const anthropic = createAnthropic({ apiKey });
      return anthropic(modelName);
    }
    case "google": {
      const google = createGoogleGenerativeAI({ apiKey });
      return google(modelName);
    }
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

function formatHistoryForLLM(messages: Message[]) {
  return messages
    .filter((msg) => msg.role === "contact" || msg.role === "agent")
    .map((msg) => ({
      role: msg.role === "contact" ? "user" as const : "assistant" as const,
      content: msg.content,
    }));
}

async function validateResponse(params: {
  systemPrompt: string;
  response: string;
  provider: LLMProvider;
  apiKey: string;
}): Promise<ValidationResult> {
  const { systemPrompt, response, provider, apiKey } = params;
  const validationModel = createModel(provider, VALIDATION_MODELS[provider], apiKey);

  const prompt = `Você é um verificador de conformidade. O system prompt abaixo contém regras que o assistente DEVE seguir. Verifique se a resposta gerada viola alguma regra explícita.

System prompt:
${systemPrompt}

Resposta gerada:
${response}

Responda APENAS com JSON válido, sem markdown:
{"compliant": true}
ou
{"compliant": false, "violation": "descrição breve da regra violada"}`;

  try {
    const result = await generateText({
      model: validationModel,
      prompt,
      maxTokens: 100,
      temperature: 0,
    });

    const parsed = JSON.parse(result.text.trim()) as ValidationResult;
    return parsed;
  } catch {
    return { compliant: true };
  }
}

export async function runAgent(params: RunAgentParams): Promise<RunAgentResult> {
  const { agent, messages, currentMessage, apiKey, organizationId } = params;

  const startTime = Date.now();
  const model = createModel(agent.provider, agent.model, apiKey);
  const tools = buildToolsForAgent({
    organizationId,
    agentId: agent.id,
    toolsConfig: agent.tools_config,
    apiKey,
  });
  const history = formatHistoryForLLM(messages);

  let totalTokens = 0;
  let allToolCalls: string[] = [];
  let lastText = "";
  let systemPrompt = agent.system_prompt;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const result = await generateText({
      model,
      system: systemPrompt,
      messages: [
        ...history,
        { role: "user", content: currentMessage.content },
      ],
      tools,
      maxSteps: agent.max_steps,
      temperature: agent.temperature,
      maxTokens: agent.max_tokens,
    });

    totalTokens += result.usage?.totalTokens || 0;
    allToolCalls = allToolCalls.concat(
      result.steps.flatMap((step) => step.toolCalls || []).map((tc) => tc.toolName)
    );
    lastText = result.text;

    const validation = await validateResponse({
      systemPrompt: agent.system_prompt,
      response: result.text,
      provider: agent.provider,
      apiKey,
    });

    if (validation.compliant) {
      break;
    }

    if (attempt === MAX_ATTEMPTS) {
      console.warn(
        `[agent-runner] Resposta enviada após ${MAX_ATTEMPTS} tentativas com violation: "${validation.violation}"`
      );
      break;
    }

    systemPrompt = `${agent.system_prompt}\n\n[ATENÇÃO: sua resposta anterior violou a seguinte regra: "${validation.violation}". Corrija na próxima resposta.]`;
  }

  return {
    text: lastText,
    model: agent.model,
    tokensUsed: totalTokens,
    latencyMs: Date.now() - startTime,
    toolCalls: allToolCalls,
  };
}
