import type { FastifyInstance } from "fastify";
import { getAdminClient } from "@aula-agente/database";
import { authMiddleware } from "../../middleware/auth";
import { decrypt } from "../../lib/crypto";

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
      if (!messages?.length) return reply.status(400).send({ error: "Mensagens obrigatórias" });

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
      const content = data.choices?.[0]?.message?.content ?? "";
      return reply.send({ message: content });
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
