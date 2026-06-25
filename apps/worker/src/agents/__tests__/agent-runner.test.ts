import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockBuildToolsForAgent } = vi.hoisted(() => ({
  mockBuildToolsForAgent: vi.fn(() => ({})),
}));

vi.mock("ai", () => ({
  generateText: vi.fn(),
}));
vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: vi.fn(() => vi.fn(() => "openai-model-instance")),
}));
vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: vi.fn(() => vi.fn(() => "anthropic-model-instance")),
}));
vi.mock("@ai-sdk/google", () => ({
  createGoogleGenerativeAI: vi.fn(() => vi.fn(() => "google-model-instance")),
}));
vi.mock("../tools/registry", () => ({
  buildToolsForAgent: mockBuildToolsForAgent,
}));

import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { runAgent } from "../agent-runner";

const baseAgent = {
  id: "agent-1",
  organization_id: "org-1",
  name: "Test Agent",
  description: "",
  system_prompt: "You are helpful.",
  model: "gpt-4o-mini",
  provider: "openai" as const,
  temperature: 0.7,
  max_tokens: 1024,
  max_steps: 3,
  tools_config: { search_knowledge: false, search_faq: false, search_web: false, search_products: false },
  activation_rules: [],
  is_active: true,
  created_at: "",
  updated_at: "",
};

const currentMessage = {
  id: "msg-1",
  conversation_id: "conv-1",
  organization_id: "org-1",
  evolution_message_id: null,
  role: "contact" as const,
  content: "OlÃ¡",
  media_url: null,
  media_type: null,
  metadata: {},
  created_at: "",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(generateText).mockResolvedValue({
    text: "OlÃ¡! Como posso ajudar?",
    usage: { totalTokens: 50, promptTokens: 30, completionTokens: 20 },
    steps: [],
  } as never);
});

describe("runAgent", () => {
  it("retorna texto, modelo, tokens e latÃªncia", async () => {
    const result = await runAgent({
      agent: baseAgent,
      messages: [],
      currentMessage,
      apiKey: "sk-test",
      organizationId: "org-1",
      conversationId: "conv-1",
    });

    expect(result.text).toBe("OlÃ¡! Como posso ajudar?");
    expect(result.model).toBe("gpt-4o-mini");
    expect(result.tokensUsed).toBeGreaterThanOrEqual(50);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("passa agent.max_steps para generateText", async () => {
    await runAgent({
      agent: { ...baseAgent, max_steps: 7 },
      messages: [],
      currentMessage,
      apiKey: "sk-test",
      organizationId: "org-1",
      conversationId: "conv-1",
    });

    const call = vi.mocked(generateText).mock.calls[0][0];
    expect(call.maxSteps).toBe(7);
  });

  it("chama buildToolsForAgent com tools_config correto", async () => {
    await runAgent({
      agent: { ...baseAgent, tools_config: { search_knowledge: true, search_faq: false, search_web: false, search_products: false } },
      messages: [],
      currentMessage,
      apiKey: "sk-test",
      organizationId: "org-1",
      conversationId: "conv-1",
    });

    expect(mockBuildToolsForAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        toolsConfig: { search_knowledge: true, search_faq: false, search_web: false, search_products: false },
      })
    );
  });

  it("inclui histÃ³rico formatado nas mensagens do LLM", async () => {
    const history = [
      { ...currentMessage, id: "msg-0", role: "agent" as const, content: "Como posso ajudar?" },
    ];

    await runAgent({
      agent: baseAgent,
      messages: history,
      currentMessage,
      apiKey: "sk-test",
      organizationId: "org-1",
      conversationId: "conv-1",
    });

    const call = vi.mocked(generateText).mock.calls[0][0];
    const messages = call.messages as Array<{ role: string; content: string }>;
    expect(messages[0]).toEqual({ role: "assistant", content: "Como posso ajudar?" });
    const lastMsg = messages[messages.length - 1];
    expect(lastMsg.role).toBe("user");
    expect(lastMsg.content).toContain("OlÃ¡");
    expect(lastMsg.content).toContain("<user_message>");
  });

  it("retorna resposta diretamente se validador aprova na primeira tentativa", async () => {
    // generateText: 1Âª chamada = resposta do agente, 2Âª chamada = validador retorna compliant
    vi.mocked(generateText)
      .mockResolvedValueOnce({
        text: "Resposta ok",
        usage: { totalTokens: 50, promptTokens: 30, completionTokens: 20 },
        steps: [],
      } as never)
      .mockResolvedValueOnce({
        text: '{"compliant": true}',
        usage: { totalTokens: 10, promptTokens: 8, completionTokens: 2 },
        steps: [],
      } as never);

    const result = await runAgent({
      agent: baseAgent,
      messages: [],
      currentMessage,
      apiKey: "sk-test",
      organizationId: "org-1",
      conversationId: "conv-1",
    });

    expect(result.text).toBe("Resposta ok");
    expect(vi.mocked(generateText)).toHaveBeenCalledTimes(2);
  });

  it("retenta e retorna segunda resposta se primeira viola regra", async () => {
    vi.mocked(generateText)
      .mockResolvedValueOnce({
        text: "Resposta ruim",
        usage: { totalTokens: 50, promptTokens: 30, completionTokens: 20 },
        steps: [],
      } as never)
      .mockResolvedValueOnce({
        text: '{"compliant": false, "violation": "mencionou concorrente"}',
        usage: { totalTokens: 10, promptTokens: 8, completionTokens: 2 },
        steps: [],
      } as never)
      .mockResolvedValueOnce({
        text: "Resposta corrigida",
        usage: { totalTokens: 50, promptTokens: 30, completionTokens: 20 },
        steps: [],
      } as never)
      .mockResolvedValueOnce({
        text: '{"compliant": true}',
        usage: { totalTokens: 10, promptTokens: 8, completionTokens: 2 },
        steps: [],
      } as never);

    const result = await runAgent({
      agent: baseAgent,
      messages: [],
      currentMessage,
      apiKey: "sk-test",
      organizationId: "org-1",
      conversationId: "conv-1",
    });

    expect(result.text).toBe("Resposta corrigida");
    // 2 geraÃ§Ãµes + 2 validaÃ§Ãµes = 4 chamadas
    expect(vi.mocked(generateText)).toHaveBeenCalledTimes(4);
  });

  it("retorna Ãºltima resposta (fail open) se todas as 3 tentativas violam", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // 3 geraÃ§Ãµes + 3 validaÃ§Ãµes = 6 chamadas
    vi.mocked(generateText)
      .mockResolvedValueOnce({ text: "Ruim 1", usage: { totalTokens: 50, promptTokens: 30, completionTokens: 20 }, steps: [] } as never)
      .mockResolvedValueOnce({ text: '{"compliant": false, "violation": "erro 1"}', usage: { totalTokens: 10, promptTokens: 8, completionTokens: 2 }, steps: [] } as never)
      .mockResolvedValueOnce({ text: "Ruim 2", usage: { totalTokens: 50, promptTokens: 30, completionTokens: 20 }, steps: [] } as never)
      .mockResolvedValueOnce({ text: '{"compliant": false, "violation": "erro 2"}', usage: { totalTokens: 10, promptTokens: 8, completionTokens: 2 }, steps: [] } as never)
      .mockResolvedValueOnce({ text: "Ruim 3", usage: { totalTokens: 50, promptTokens: 30, completionTokens: 20 }, steps: [] } as never)
      .mockResolvedValueOnce({ text: '{"compliant": false, "violation": "erro 3"}', usage: { totalTokens: 10, promptTokens: 8, completionTokens: 2 }, steps: [] } as never);

    const result = await runAgent({
      agent: baseAgent,
      messages: [],
      currentMessage,
      apiKey: "sk-test",
      organizationId: "org-1",
      conversationId: "conv-1",
    });

    expect(result.text).toBe("Ruim 3");
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("erro 3"));
    warnSpy.mockRestore();
  });

  it("trata parse invÃ¡lido do validador como compliant (fail open)", async () => {
    vi.mocked(generateText)
      .mockResolvedValueOnce({ text: "Resposta ok", usage: { totalTokens: 50, promptTokens: 30, completionTokens: 20 }, steps: [] } as never)
      .mockResolvedValueOnce({ text: "nÃ£o Ã© json", usage: { totalTokens: 10, promptTokens: 8, completionTokens: 2 }, steps: [] } as never);

    const result = await runAgent({
      agent: baseAgent,
      messages: [],
      currentMessage,
      apiKey: "sk-test",
      organizationId: "org-1",
      conversationId: "conv-1",
    });

    expect(result.text).toBe("Resposta ok");
    expect(vi.mocked(generateText)).toHaveBeenCalledTimes(2);
  });

  it("system prompt de retry usa mensagem estÃ¡tica (PI-3: violation nÃ£o contamina system prompt)", async () => {
    vi.mocked(generateText)
      .mockResolvedValueOnce({ text: "Ruim", usage: { totalTokens: 50, promptTokens: 30, completionTokens: 20 }, steps: [] } as never)
      .mockResolvedValueOnce({ text: '{"compliant": false, "violation": "mencionou concorrente X"}', usage: { totalTokens: 10, promptTokens: 8, completionTokens: 2 }, steps: [] } as never)
      .mockResolvedValueOnce({ text: "Bom", usage: { totalTokens: 50, promptTokens: 30, completionTokens: 20 }, steps: [] } as never)
      .mockResolvedValueOnce({ text: '{"compliant": true}', usage: { totalTokens: 10, promptTokens: 8, completionTokens: 2 }, steps: [] } as never);

    await runAgent({
      agent: baseAgent,
      messages: [],
      currentMessage,
      apiKey: "sk-test",
      organizationId: "org-1",
      conversationId: "conv-1",
    });

    // A 3Âª chamada Ã© a retentativa â€” NÃƒO deve conter o texto da violation (PI-3)
    const retryCall = vi.mocked(generateText).mock.calls[2][0];
    const retrySystem = (retryCall as { system: string }).system;
    expect(retrySystem).not.toContain("mencionou concorrente X");
    expect(retrySystem).toMatch(/nÃ£o.conform|violou|regras|corrija|nova.*resposta/i);
  });

  it("passa conversationId para buildToolsForAgent", async () => {
    await runAgent({
      agent: baseAgent,
      messages: [],
      currentMessage,
      apiKey: "sk-test",
      organizationId: "org-1",
      conversationId: "conv-xyz",
    });

    expect(mockBuildToolsForAgent).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: "conv-xyz" })
    );
  });

  it("inclui instruÃ§Ã£o REGRA DE ENCERRAMENTO no system prompt enviado ao LLM", async () => {
    await runAgent({
      agent: baseAgent,
      messages: [],
      currentMessage,
      apiKey: "sk-test",
      organizationId: "org-1",
      conversationId: "conv-1",
    });

    const call = vi.mocked(generateText).mock.calls[0][0];
    expect((call as { system: string }).system).toContain("REGRA DE ENCERRAMENTO");
  });

  it("mantÃ©m instruÃ§Ã£o de encerramento no system prompt da retentativa apÃ³s violation", async () => {
    vi.mocked(generateText)
      .mockResolvedValueOnce({ text: "Ruim", usage: { totalTokens: 50, promptTokens: 30, completionTokens: 20 }, steps: [] } as never)
      .mockResolvedValueOnce({ text: '{"compliant": false, "violation": "erro"}', usage: { totalTokens: 10, promptTokens: 8, completionTokens: 2 }, steps: [] } as never)
      .mockResolvedValueOnce({ text: "Bom", usage: { totalTokens: 50, promptTokens: 30, completionTokens: 20 }, steps: [] } as never)
      .mockResolvedValueOnce({ text: '{"compliant": true}', usage: { totalTokens: 10, promptTokens: 8, completionTokens: 2 }, steps: [] } as never);

    await runAgent({
      agent: baseAgent,
      messages: [],
      currentMessage,
      apiKey: "sk-test",
      organizationId: "org-1",
      conversationId: "conv-1",
    });

    // 3Âª chamada = retentativa â€” system prompt deve ainda conter a instruÃ§Ã£o de encerramento
    const retryCall = vi.mocked(generateText).mock.calls[2][0];
    expect((retryCall as { system: string }).system).toContain("REGRA DE ENCERRAMENTO");
  });
});

describe("runAgent â€” suporte a imagem multimodal", () => {
  const imageContent = { base64: "aW1hZ2U=", mimeType: "image/jpeg" };
  let openaiCallable: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    openaiCallable = vi.fn((modelName: string) => `openai-model-${modelName}`);
    vi.mocked(createOpenAI).mockReturnValue(openaiCallable as never);

    vi.mocked(generateText).mockResolvedValue({
      text: "resposta sobre a imagem",
      usage: { totalTokens: 30, promptTokens: 20, completionTokens: 10 },
      steps: [],
    } as never);
  });

  it("inclui image part na mensagem quando imageContent Ã© fornecido", async () => {
    await runAgent({
      agent: { ...baseAgent, model: "gpt-4o", provider: "openai" },
      messages: [],
      currentMessage: { ...currentMessage, media_type: "image", content: "[imagem]" },
      apiKey: "sk-test",
      organizationId: "org-1",
      conversationId: "conv-1",
      imageContent,
    });

    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: "user",
            content: expect.arrayContaining([
              expect.objectContaining({ type: "text", text: expect.stringContaining("[imagem]") }),
              expect.objectContaining({ type: "image" }),
            ]),
          }),
        ]),
      })
    );
  });

  it("usa modelo vision fallback (gpt-4o) quando modelo configurado nÃ£o suporta visÃ£o (gpt-4.1-nano)", async () => {
    await runAgent({
      agent: { ...baseAgent, model: "gpt-4.1-nano", provider: "openai" },
      messages: [],
      currentMessage: { ...currentMessage, media_type: "image", content: "[imagem]" },
      apiKey: "sk-test",
      organizationId: "org-1",
      conversationId: "conv-1",
      imageContent,
    });

    expect(openaiCallable).toHaveBeenCalledWith("gpt-4o");
  });

  it("sem imageContent, mensagem Ã© texto simples encapsulado em <user_message>", async () => {
    await runAgent({
      agent: { ...baseAgent, model: "gpt-4o", provider: "openai" },
      messages: [],
      currentMessage,
      apiKey: "sk-test",
      organizationId: "org-1",
      conversationId: "conv-1",
    });

    const call = vi.mocked(generateText).mock.calls[0][0] as { messages: Array<{ role: string; content: string }> };
    const lastMsg = call.messages[call.messages.length - 1];
    expect(lastMsg.role).toBe("user");
    expect(lastMsg.content).toContain(currentMessage.content);
    expect(lastMsg.content).toContain("<user_message>");
  });
});

