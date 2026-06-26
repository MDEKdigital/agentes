// Salomão Criador — agente especializado em criação de prompts via conversa
// Roda apenas quando a conversa está em PROMPT_CREATION_MODE.
// Após gerar o prompt, envia para o Salomão Auditor validar.

import { generateText } from "ai";
import { createModel } from "../lib/create-model";
import { withTimeout, LLM_TIMEOUT_MS, VALIDATION_TIMEOUT_MS } from "../lib/with-timeout";
import type { Message } from "@aula-agente/shared";
import { SALOMAO_AUDITOR_IDENTITY } from "./salomao-decisor";

const CRIADOR_MODEL = "gpt-4.1-mini";

async function auditGeneratedPrompt(prompt: string, apiKey: string): Promise<{ compliant: boolean; violation?: string }> {
  try {
    const res = await withTimeout(fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: CRIADOR_MODEL,
        messages: [
          { role: "system", content: SALOMAO_AUDITOR_IDENTITY },
          {
            role: "user",
            content: `Analise o prompt abaixo e verifique se viola as regras globais do Projeto Agentes.\nResponda APENAS com JSON válido, sem markdown:\n{"compliant": true}\nou\n{"compliant": false, "violation": "descrição breve"}\n\n<prompt_gerado>\n${prompt}\n</prompt_gerado>`,
          },
        ],
        max_tokens: 100,
        temperature: 0,
      }),
    }), VALIDATION_TIMEOUT_MS);
    if (!res.ok) return { compliant: true };
    const data = await res.json() as { choices: { message: { content: string } }[] };
    const raw = (data.choices?.[0]?.message?.content ?? "").trim();
    const jsonText = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    return JSON.parse(jsonText) as { compliant: boolean; violation?: string };
  } catch {
    return { compliant: true };
  }
}

const CRIADOR_SYSTEM_PROMPT = `Você é Salomão Criador, especialista em criação de prompts de alta performance para agentes de IA do Projeto Agentes.

Você atua como CONSULTOR, não como vendedor. Seu papel é guiar o usuário passo a passo para criar um prompt completo, eficaz e adaptado ao negócio dele.

COMPORTAMENTO OBRIGATÓRIO:
- Faça APENAS UMA pergunta por vez
- Aguarde a resposta antes de avançar
- Valide positivamente cada resposta antes de continuar
- Use linguagem natural, direta e empática — não robótica
- Adapte as próximas perguntas com base nas respostas anteriores
- Seja objetivo, estratégico e empolgante

PERGUNTAS A COBRIR (na ordem que fizer mais sentido para a conversa):
1. Nome do negócio e nicho de atuação
2. Público-alvo principal (quem compra ou contrata)
3. Produtos ou serviços principais e seus diferenciais
4. Tom de comunicação desejado (formal, casual, técnico, amigável, consultivo...)
5. Canal principal de uso (WhatsApp vendas, suporte, agendamento, qualificação de leads...)
6. O que o agente vai fazer no dia a dia
7. O que o agente JAMAIS deve dizer ou fazer (limites e restrições)
8. Informações críticas que o agente precisa saber sempre (preços, políticas, horários, regras)
9. Como o agente deve se identificar (nome do assistente)

QUANDO TIVER INFORMAÇÃO SUFICIENTE (após cobrir os pontos principais):
- Avise que vai gerar o prompt agora
- Gere um prompt completo, detalhado e profissional
- Entregue o prompt EXATAMENTE dentro das tags <prompt> e </prompt> — sem texto fora dessas tags na linha do prompt
- Após as tags, pergunte se o usuário quer ajustar algo

REGRAS:
- Nunca invente informações sobre o negócio do usuário
- Nunca pule etapas sem perguntar
- O prompt gerado deve conter: identidade do agente, objetivo, tom, regras, limites e formato de resposta
- Não inclua as tags <prompt></prompt> em perguntas — apenas na entrega final do prompt completo
- Seja preciso: o prompt precisa funcionar sem ajustes adicionais`;

export interface CriadorResult {
  text: string;
  promptGenerated: boolean;
  finalPrompt?: string;
}

function extractPrompt(text: string): string | null {
  const match = text.match(/<prompt>([\s\S]*?)<\/prompt>/i);
  return match ? match[1].trim() : null;
}

function buildHistory(messages: Message[]) {
  return messages
    .filter((m) => m.role === "contact" || (m.role === "agent" && !!m.metadata?.salomao_criador))
    .map((m) => ({
      role: m.role === "contact" ? ("user" as const) : ("assistant" as const),
      content: m.role === "contact" ? `<user_message>\n${m.content}\n</user_message>` : m.content,
    }));
}

export async function runSalamaoCriador(params: {
  messages: Message[];
  currentMessage: Message;
  openaiKey: string;
}): Promise<CriadorResult> {
  const { messages, currentMessage, openaiKey } = params;

  const model = createModel("openai", CRIADOR_MODEL, openaiKey);
  const history = buildHistory(messages);

  const generate = async (systemOverride?: string): Promise<string> => {
    const result = await withTimeout(
      generateText({
        model,
        system: systemOverride ?? CRIADOR_SYSTEM_PROMPT,
        messages: [
          ...history,
          { role: "user" as const, content: currentMessage.content },
        ],
        maxTokens: 2000,
        temperature: 0.7,
      }),
      LLM_TIMEOUT_MS
    );
    return result.text;
  };

  let text = await generate();
  const extractedPrompt = extractPrompt(text);

  // Se não gerou um prompt ainda, retorna a pergunta normalmente
  if (!extractedPrompt) {
    return { text, promptGenerated: false };
  }

  // Salomão Auditor valida o prompt extraído contra as regras globais do Projeto Agentes
  const validation = await auditGeneratedPrompt(extractedPrompt, openaiKey);

  if (!validation.compliant) {
    const RECUSA = "Não consegui gerar um prompt em conformidade com as regras do sistema. Por favor, revise as informações fornecidas e tente novamente.";
    let retrySucceeded = false;
    const retryText = await generate(
      `${CRIADOR_SYSTEM_PROMPT}\n\n[AVISO INTERNO]: O prompt foi reprovado. Violação: "${validation.violation}". Corrija e reescreva dentro das tags <prompt></prompt>.`
    ).then(t => { retrySucceeded = true; return t; }).catch(() => text);

    // Só usa o retry se ele ainda contiver as tags — evita vazar texto interno ao usuário
    text = extractPrompt(retryText) ? retryText : text;

    // Se o retry falhou (threw), recusa imediatamente sem depender do re-audit fail-open
    if (!retrySucceeded || !extractPrompt(text)) {
      return { text: RECUSA, promptGenerated: false };
    }

    // Re-audita o prompt corrigido
    const revalidation = await auditGeneratedPrompt(extractPrompt(text)!, openaiKey);
    if (!revalidation.compliant) {
      return { text: RECUSA, promptGenerated: false };
    }
  }

  const finalPrompt = extractPrompt(text) ?? extractedPrompt;

  // Remove as tags — o caller adiciona a confirmação após confirmar o save no DB
  const cleanText = text
    .replace(/<prompt>[\s\S]*?<\/prompt>/gi, "")
    .trim();

  return {
    text: cleanText,
    promptGenerated: true,
    finalPrompt,
  };
}
