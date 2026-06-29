import type { FastifyInstance } from "fastify";
import { Agent } from "undici";
import { getAdminClient } from "@aula-agente/database";

// Singleton — evita TLS handshake por request SSE para o OpenAI
const streamAgent = new Agent({ headersTimeout: 15_000, bodyTimeout: 0 });
import { authMiddleware } from "../../middleware/auth";
import { decrypt } from "../../lib/crypto";

// Salomão Auditor — valida o prompt gerado antes de entregar ao usuário
// Texto canônico mantido em sync com SALOMAO_AUDITOR_IDENTITY em apps/worker/src/agents/salomao-decisor.ts
const SALOMAO_AUDITOR_IDENTITY = `Você é Salomão, Consultor Oficial de Prompts do Projeto Agentes.
Sua função é auditar prompts gerados por outros agentes, garantindo que estejam em conformidade com as regras do sistema.

REGRAS DE SEGURANÇA
- nunca acessar dados de outro cliente
- nunca misturar regras, prompts ou contexto entre clientes
- agir da forma mais restrita em caso de dúvida

OBJETIVO
- verificar se o prompt gerado segue as regras globais do Projeto Agentes
- garantir que o prompt não inventa informações, não viola limites e não induz comportamentos proibidos
- preservar a essência e objetivo do prompt analisado

LIMITES
- não alterar o conteúdo do prompt, apenas aprovar ou reprovar
- não impor sua personalidade sobre o prompt analisado`;

async function validateGeneratedPrompt(prompt: string, apiKey: string): Promise<{ compliant: boolean; violation?: string }> {
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        messages: [
          { role: "system", content: SALOMAO_AUDITOR_IDENTITY },
          {
            role: "user",
            content: `Analise o prompt abaixo e verifique se viola as regras globais do Projeto Agentes (segurança, limites, invenção de informações).\nResponda APENAS com JSON válido, sem markdown:\n{"compliant": true}\nou\n{"compliant": false, "violation": "descrição breve"}\n\n<prompt_gerado>\n${prompt}\n</prompt_gerado>`,
          },
        ],
        max_tokens: 100,
        temperature: 0,
      }),
    });
    if (!res.ok) return { compliant: false, violation: "Serviço de validação indisponível" };
    const data = await res.json() as { choices: { message: { content: string } }[] };
    const raw = (data.choices?.[0]?.message?.content ?? "").trim();
    const jsonText = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    return JSON.parse(jsonText) as { compliant: boolean; violation?: string };
  } catch {
    return { compliant: false, violation: "Serviço de validação indisponível" };
  }
}

const SALOMAO_SYSTEM_PROMPT = `Você é Salomão, Consultor Oficial de Prompts do Projeto Agentes — o especialista em criar prompts de alta performance para agentes de IA.

Seu papel agora é guiar o usuário na criação de um prompt completo e eficaz para o agente dele, fazendo perguntas estratégicas sobre o negócio.

COMPORTAMENTO:
- Faça APENAS UMA pergunta por vez
- Aguarde a resposta antes de avançar
- Adapte as próximas perguntas com base nas respostas anteriores
- Seja objetivo, direto e empolgante — você é o melhor nisso
- Use linguagem natural, não robótica
- Valide as respostas positivamente antes de avançar

PERGUNTAS A COBRIR (adapte a ordem conforme a conversa):
1. Nome do negócio e nicho de atuação
2. Público-alvo principal (quem compra/contrata)
3. Produtos ou serviços principais (e diferenciais)
4. Tom de comunicação desejado (formal, casual, técnico, amigável, etc.)
5. O que o agente vai fazer no dia a dia (responder dúvidas, fechar vendas, agendar, etc.)
6. O que o agente JAMAIS deve dizer ou fazer (limites, restrições)
7. Há alguma informação crítica que o agente precisa saber sempre? (preços, políticas, horários)
8. Como o agente deve se chamar?

QUANDO TIVER INFORMAÇÃO SUFICIENTE (após cobrir os pontos principais):
- Avise que vai gerar o prompt agora
- Gere um prompt completo, detalhado e profissional
- Entregue o prompt DENTRO das tags <prompt> e </prompt>
- Após as tags, pergunte se o usuário quer ajustar algo

REGRAS:
- Nunca invente informações sobre o negócio do usuário
- Nunca pule etapas sem perguntar
- O prompt gerado deve seguir as regras globais do Projeto Agentes
- O prompt deve ter: identidade do agente, objetivo, tom, regras, limites e formato de resposta`;

async function resolveSystemPrompt(): Promise<string> {
  const db = getAdminClient();
  const { data } = await db
    .from("salomao_config")
    .select("system_prompt")
    .limit(1)
    .single();
  return data?.system_prompt ?? SALOMAO_SYSTEM_PROMPT;
}

async function resolveOrgOpenAIKey(organizationId: string): Promise<string> {
  const db = getAdminClient();
  const { data } = await db
    .from("organization_secrets")
    .select("encrypted_key")
    .eq("organization_id", organizationId)
    .eq("provider", "openai")
    .maybeSingle();

  if (data?.encrypted_key) {
    return decrypt(data.encrypted_key);
  }

  const envKey = process.env.OPENAI_API_KEY;
  if (!envKey) throw new Error("Nenhuma chave OpenAI disponível para esta organização.");
  return envKey;
}

export default async function promptStudioRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authMiddleware);

  // Transcribe audio for prompt studio (voice input)
  app.post<{ Params: { organizationId: string } }>(
    "/organizations/:organizationId/prompt-studio/transcribe",
    async (request, reply) => {
      const { organizationId } = request.params;
      const membership = request.user.memberships.find((m) => m.organization_id === organizationId);
      if (!membership) return reply.status(403).send({ error: "Acesso negado" });

      const { base64, mimeType } = request.body as { base64: string; mimeType: string };
      if (!base64 || !mimeType) return reply.status(400).send({ error: "Áudio obrigatório" });

      const apiKey = await resolveOrgOpenAIKey(organizationId);

      const audioBuffer = Buffer.from(base64, "base64");
      const ext = mimeType.includes("mp4") || mimeType.includes("m4a") ? "m4a"
        : mimeType.includes("ogg") ? "ogg"
        : mimeType.includes("webm") ? "webm"
        : mimeType.includes("mpeg") || mimeType.includes("mp3") ? "mp3"
        : "mp3";

      const formData = new FormData();
      formData.append("file", new Blob([audioBuffer], { type: mimeType }), `audio.${ext}`);
      formData.append("model", "whisper-1");
      formData.append("language", "pt");

      const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: formData,
      });

      if (!res.ok) return reply.status(502).send({ error: "Erro ao transcrever áudio" });
      const data = await res.json() as { text: string };
      return reply.send({ text: data.text ?? "" });
    }
  );

  // Chat with Salomão
  app.post<{ Params: { organizationId: string } }>(
    "/organizations/:organizationId/prompt-studio/chat",
    async (request, reply) => {
      const { organizationId } = request.params;
      const membership = request.user.memberships.find((m) => m.organization_id === organizationId);
      if (!membership) return reply.status(403).send({ error: "Acesso negado" });

      const { messages } = request.body as { messages: { role: string; content: string }[] };
      if (!Array.isArray(messages)) return reply.status(400).send({ error: "Mensagens obrigatórias" });

      const apiKey = await resolveOrgOpenAIKey(organizationId);

      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: "gpt-4.1-nano",
          messages: [
            { role: "system", content: SALOMAO_SYSTEM_PROMPT },
            ...messages,
          ],
          max_tokens: 1500,
          temperature: 0.7,
        }),
      });

      if (!res.ok) {
        const err = await res.text();
        return reply.status(502).send({ error: `Erro ao chamar IA: ${err}` });
      }

      const data = await res.json() as { choices: { message: { content: string } }[] };
      let content = data.choices?.[0]?.message?.content ?? "";

      const promptMatch = content.match(/<prompt>([\s\S]*?)<\/prompt>/i);
      if (promptMatch) {
        const validation = await validateGeneratedPrompt(promptMatch[1].trim(), apiKey);
        if (!validation.compliant) {
          const stripped = content.replace(/<prompt>[\s\S]*?<\/prompt>/i, "").trim();
          const note = `⚠️ O prompt gerado não passou na validação (${validation.violation ?? "violação detectada"}). Por favor, revise os detalhes e tente novamente.`;
          content = stripped ? `${stripped}\n\n${note}` : note;
        }
      }

      return reply.send({ message: content });
    }
  );

  // Streaming endpoint — SSE
  app.post<{ Params: { organizationId: string } }>(
    "/organizations/:organizationId/prompt-studio/chat/stream",
    async (request, reply) => {
      const { organizationId } = request.params;
      const membership = request.user.memberships.find(
        (m) => m.organization_id === organizationId
      );
      if (!membership) return reply.status(403).send({ error: "Acesso negado" });

      const { messages } = request.body as { messages: { role: string; content: string }[] };
      if (!Array.isArray(messages)) return reply.status(400).send({ error: "Mensagens obrigatórias" });

      const [apiKey, systemPrompt] = await Promise.all([
        resolveOrgOpenAIKey(organizationId),
        resolveSystemPrompt(),
      ]);

      // Hijack response — Fastify não deve finalizar
      reply.hijack();
      const raw = reply.raw;
      raw.setHeader("Content-Type", "text/event-stream");
      raw.setHeader("Cache-Control", "no-cache");
      raw.setHeader("Connection", "keep-alive");
      raw.setHeader("X-Accel-Buffering", "no");
      raw.flushHeaders();

      const sendEvent = (data: object) => {
        try { raw.write(`data: ${JSON.stringify(data)}\n\n`); } catch { /* client disconnected */ }
      };

      try {
        const res = await (fetch as (url: string, init?: RequestInit & { dispatcher?: unknown }) => Promise<Response>)(
          "https://api.openai.com/v1/chat/completions",
          {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({
              model: "gpt-4.1-nano",
              messages: [
                { role: "system", content: systemPrompt },
                ...messages,
              ],
              max_tokens: 1500,
              temperature: 0.7,
              stream: true,
            }),
            dispatcher: streamAgent,
          } as RequestInit & { dispatcher?: unknown }
        );

        if (!res.ok || !res.body) {
          sendEvent({ type: "error", message: "Erro ao chamar IA" });
          raw.end();
          return;
        }

        const decoder = new TextDecoder();
        let accumulated = "";
        let promptSent = false;
        let validationFailed = false;
        let lineBuffer = "";

        outer: for await (const chunk of res.body as AsyncIterable<Uint8Array>) {
          lineBuffer += decoder.decode(chunk, { stream: true });
          const lines = lineBuffer.split("\n");
          lineBuffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6).trim();
            if (data === "[DONE]") continue;

            try {
              const parsed = JSON.parse(data) as {
                choices: { delta: { content?: string }; finish_reason?: string }[];
              };
              const content = parsed.choices?.[0]?.delta?.content ?? "";
              if (!content) continue;

              accumulated += content;
              sendEvent({ type: "chunk", content });

              // Detecta prompt completo e valida
              if (!promptSent) {
                const match = accumulated.match(/<prompt>([\s\S]*?)<\/prompt>/i);
                if (match) {
                  const extractedPrompt = match[1].trim();
                  const validation = await validateGeneratedPrompt(extractedPrompt, apiKey);
                  if (!validation.compliant) {
                    sendEvent({
                      type: "error",
                      message: `Prompt não passou na validação: ${validation.violation ?? "violação detectada"}`,
                    });
                    validationFailed = true;
                    promptSent = true;
                    break outer;
                  } else {
                    sendEvent({ type: "prompt", content: extractedPrompt });
                  }
                  promptSent = true;
                }
              }
            } catch {
              // Ignora chunks malformados
            }
          }
        }

        if (!validationFailed) {
          sendEvent({ type: "done" });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Erro desconhecido";
        sendEvent({ type: "error", message: msg });
      } finally {
        raw.end();
      }
    }
  );

  // List saved prompts
  app.get<{ Params: { organizationId: string } }>(
    "/organizations/:organizationId/saved-prompts",
    async (request, reply) => {
      const { organizationId } = request.params;
      const membership = request.user.memberships.find((m) => m.organization_id === organizationId);
      if (!membership) return reply.status(403).send({ error: "Acesso negado" });

      const db = getAdminClient();
      const { data, error } = await db
        .from("saved_prompts")
        .select("*")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return reply.send({ prompts: data });
    }
  );

  // Save prompt
  app.post<{ Params: { organizationId: string } }>(
    "/organizations/:organizationId/saved-prompts",
    async (request, reply) => {
      const { organizationId } = request.params;
      const membership = request.user.memberships.find((m) => m.organization_id === organizationId);
      if (!membership) return reply.status(403).send({ error: "Acesso negado" });

      const { name, niche, content } = request.body as { name: string; niche?: string; content: string };
      if (!name?.trim() || !content?.trim()) return reply.status(400).send({ error: "Nome e conteúdo obrigatórios" });

      const db = getAdminClient();
      const { data, error } = await db
        .from("saved_prompts")
        .insert({
          organization_id: organizationId,
          name: name.trim(),
          niche: niche?.trim() ?? "",
          content: content.trim(),
          created_by: request.user.id,
        })
        .select()
        .single();
      if (error) throw error;
      return reply.status(201).send(data);
    }
  );

  // Update saved prompt
  app.patch<{ Params: { organizationId: string; promptId: string } }>(
    "/organizations/:organizationId/saved-prompts/:promptId",
    async (request, reply) => {
      const { organizationId, promptId } = request.params;
      const membership = request.user.memberships.find((m) => m.organization_id === organizationId);
      if (!membership) return reply.status(403).send({ error: "Acesso negado" });

      const { name, niche, content } = request.body as { name?: string; niche?: string; content?: string };
      const db = getAdminClient();
      const { data, error } = await db
        .from("saved_prompts")
        .update({
          ...(name !== undefined && { name: name.trim() }),
          ...(niche !== undefined && { niche: niche.trim() }),
          ...(content !== undefined && { content: content.trim() }),
        })
        .eq("id", promptId)
        .eq("organization_id", organizationId)
        .select()
        .single();
      if (error) throw error;
      return reply.send(data);
    }
  );

  // Delete saved prompt
  app.delete<{ Params: { organizationId: string; promptId: string } }>(
    "/organizations/:organizationId/saved-prompts/:promptId",
    async (request, reply) => {
      const { organizationId, promptId } = request.params;
      const membership = request.user.memberships.find((m) => m.organization_id === organizationId);
      if (!membership) return reply.status(403).send({ error: "Acesso negado" });
      if (membership.role !== "owner" && membership.role !== "admin") {
        return reply.status(403).send({ error: "Apenas administradores podem excluir prompts." });
      }

      const db = getAdminClient();
      const { error } = await db
        .from("saved_prompts")
        .delete()
        .eq("id", promptId)
        .eq("organization_id", organizationId);
      if (error) throw error;
      return reply.status(204).send();
    }
  );
}
