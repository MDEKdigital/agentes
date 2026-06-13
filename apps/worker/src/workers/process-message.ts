import { Worker } from "bullmq";
import { QUEUE_NAMES } from "@aula-agente/shared";
import type { LLMProvider, Message } from "@aula-agente/shared";
import type { ProcessMessageJobData } from "@aula-agente/queue";
import { getSendMessageQueue } from "@aula-agente/queue";
import { getConnectionOptions } from "../lib/redis";
import { evolutionPostJson } from "../lib/evolution";
import {
  getAdminClient,
  getAgentById,
  getRecentMessages,
  getConversationById,
  createMessage,
  updateConversation,
  getInstanceById,
} from "@aula-agente/database";
import { acquireConversationLock, releaseConversationLock } from "../lib/lock";
import { resolveApiKey } from "../lib/vault";
import { runAgent } from "../agents/agent-runner";

export function matchesKeyword(content: string, keywords: string[]): boolean {
  const valid = keywords.filter((k) => k.trim().length > 0);
  return valid.some((keyword) => {
    try {
      return new RegExp(keyword, "i").test(content);
    } catch {
      console.warn(`[keyword-gate] regex inválida ignorada: ${keyword}`);
      return false;
    }
  });
}

const AUDIO_EXTENSION_MAP: Record<string, string> = {
  "audio/ogg": "ogg",
  "audio/mp4": "mp4",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/webm": "webm",
  "audio/aac": "aac",
  "audio/x-m4a": "m4a",
};

function mimeTypeToAudioExtension(mimeType: string): string {
  const base = mimeType.split(";")[0].trim();
  return AUDIO_EXTENSION_MAP[base] ?? "ogg";
}

export async function fetchMediaBase64(
  instanceName: string,
  remoteJid: string,
  messageId: string,
  messageType: string
): Promise<{ base64: string; mimeType: string }> {
  const json = await evolutionPostJson<{ base64: string; mimetype: string }>(
    `/chat/getBase64FromMediaMessage/${encodeURIComponent(instanceName)}`,
    {
      message: {
        key: { remoteJid, fromMe: false, id: messageId },
        messageType,
      },
    }
  );
  if (!json.base64 || !json.mimetype) {
    throw new Error(
      `Evolution API returned incomplete media for message ${messageId}: base64=${!!json.base64}, mimetype=${!!json.mimetype}`
    );
  }
  return { base64: json.base64, mimeType: json.mimetype };
}

export async function transcribeAudio(
  base64: string,
  mimeType: string,
  apiKey: string
): Promise<string> {
  const baseMimeType = mimeType.split(";")[0].trim();
  const audioBuffer = Buffer.from(base64, "base64");
  const audioBlob = new Blob([audioBuffer], { type: baseMimeType });
  const ext = mimeTypeToAudioExtension(mimeType);
  const formData = new FormData();
  formData.append("file", audioBlob, `audio.${ext}`);
  formData.append("model", "whisper-1");

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Whisper API error ${response.status}: ${text}`);
  }
  const json = (await response.json()) as { text: string };
  return json.text;
}

export async function preprocessAudioMessage(
  message: Message,
  instanceName: string,
  phone: string,
  provider: LLMProvider,
  apiKey: string
): Promise<Message> {
  if (!message.evolution_message_id) return message;

  const remoteJid = `${phone}@s.whatsapp.net`;

  if (provider !== "openai") {
    return {
      ...message,
      content: "[Usuário enviou um áudio. Transcrição não disponível para este agente.]",
      media_type: null,
    };
  }

  try {
    const { base64, mimeType } = await fetchMediaBase64(
      instanceName,
      remoteJid,
      message.evolution_message_id,
      "audioMessage"
    );
    const transcription = await transcribeAudio(base64, mimeType, apiKey);
    return { ...message, content: transcription, media_type: null };
  } catch (err) {
    console.warn("[process-message] Falha ao processar áudio:", (err as Error).message);
    return {
      ...message,
      content: "[Usuário enviou um áudio. Não foi possível processar.]",
      media_type: null,
    };
  }
}

export async function preprocessImageMessage(
  message: Message,
  instanceName: string,
  phone: string
): Promise<{ base64: string; mimeType: string } | null> {
  if (!message.evolution_message_id) return null;

  const remoteJid = `${phone}@s.whatsapp.net`;
  try {
    const { base64, mimeType } = await fetchMediaBase64(
      instanceName,
      remoteJid,
      message.evolution_message_id,
      "imageMessage"
    );
    return { base64, mimeType };
  } catch (err) {
    console.warn("[process-message] Falha ao buscar imagem:", (err as Error).message);
    return null;
  }
}

export function startProcessMessageWorker() {
  const worker = new Worker<ProcessMessageJobData>(
    QUEUE_NAMES.PROCESS_MESSAGE,
    async (job) => {
      const { conversationId, messageId, agentId, organizationId } = job.data;

      const lockValue = await acquireConversationLock(conversationId);
      if (!lockValue) {
        throw new Error(`Failed to acquire lock for conversation ${conversationId}`);
      }

      try {
        const db = getAdminClient();

        const agent = await getAgentById(db, agentId);
        if (!agent.is_active) {
          console.log(`Agent ${agentId} is inactive, skipping`);
          return;
        }

        const conversation = (await getConversationById(db, conversationId)) as Record<
          string,
          unknown
        >;
        if (conversation.is_human_takeover) {
          console.log(`Conversation ${conversationId} is in human takeover, skipping`);
          return;
        }

        const apiKey = await resolveApiKey(organizationId, agent.provider);

        const recentMessages = await getRecentMessages(db, conversationId, 20);

        const currentMessage = recentMessages.find((m) => m.id === messageId);
        if (!currentMessage) {
          throw new Error(`Message ${messageId} not found`);
        }

        const history = recentMessages.filter((m) => m.id !== messageId);

        // Keyword activation guard
        if (
          agent.activation_keywords.length > 0 &&
          !(conversation as unknown as { is_keyword_activated: boolean }).is_keyword_activated
        ) {
          if (!matchesKeyword(currentMessage.content, agent.activation_keywords)) {
            console.log(`[keyword-gate] Conversa ${conversationId} aguardando keyword — mensagem ignorada`);
            return;
          }
          await updateConversation(db, conversationId, { is_keyword_activated: true });
          console.log(`[keyword-gate] Conversa ${conversationId} ativada por keyword`);
        }

        const contact = conversation.contacts as { phone: string } | null;
        if (!contact?.phone) {
          throw new Error(`Contact phone not found for conversation ${conversationId}`);
        }
        const evolutionInstanceId = conversation.evolution_instance_id as string | null;
        if (!evolutionInstanceId) {
          throw new Error(`Conversation ${conversationId} has no evolution_instance_id`);
        }

        // Media preprocessing — fetch instance only when needed (text messages skip this DB call)
        let instance: Awaited<ReturnType<typeof getInstanceById>> | undefined;
        let effectiveMessage = currentMessage;
        let imageContent: { base64: string; mimeType: string } | undefined;

        if (currentMessage.media_type === "audio" || currentMessage.media_type === "image") {
          instance = await getInstanceById(db, evolutionInstanceId);
        }

        if (currentMessage.media_type === "audio") {
          effectiveMessage = await preprocessAudioMessage(
            currentMessage,
            instance!.instance_name,
            contact.phone,
            agent.provider,
            apiKey
          );
        } else if (currentMessage.media_type === "image") {
          const imgResult = await preprocessImageMessage(
            currentMessage,
            instance!.instance_name,
            contact.phone
          );
          if (imgResult) {
            imageContent = imgResult;
          } else {
            effectiveMessage = {
              ...currentMessage,
              content: "[Usuário enviou uma imagem. Não foi possível carregar para processamento.]",
              media_type: null,
            };
          }
        }

        const result = await runAgent({
          agent,
          messages: history,
          currentMessage: effectiveMessage,
          apiKey,
          organizationId,
          imageContent,
        });

        const responseMessage = await createMessage(db, {
          conversation_id: conversationId,
          organization_id: organizationId,
          evolution_message_id: null,
          role: "agent",
          content: result.text,
          media_url: null,
          media_type: null,
          metadata: {
            model: result.model,
            tokens_used: result.tokensUsed,
            latency_ms: result.latencyMs,
            tool_calls: result.toolCalls,
          },
        });

        await updateConversation(db, conversationId, {
          last_message_at: new Date().toISOString(),
          status: "waiting",
        });

        if (!instance) {
          instance = await getInstanceById(db, evolutionInstanceId);
        }

        const sendQueue = getSendMessageQueue();
        await sendQueue.add("send-message", {
          conversationId,
          messageId: responseMessage.id,
          instanceId: instance.id,
          phone: contact.phone,
          content: result.text,
          organizationId,
        });

        console.log(`Processed message ${messageId} -> response ${responseMessage.id}`);
      } finally {
        await releaseConversationLock(conversationId, lockValue);
      }
    },
    {
      connection: getConnectionOptions(),
      concurrency: 10,
    }
  );

  worker.on("failed", (job, err) => {
    console.error(`Job ${job?.id} failed:`, err.message);
  });

  console.log("Process-message worker started");
  return worker;
}
