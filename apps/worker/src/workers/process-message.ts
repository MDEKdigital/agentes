import { Worker } from "bullmq";
import { QUEUE_NAMES } from "@aula-agente/shared";
import type { LLMProvider, Message } from "@aula-agente/shared";
import type { ProcessMessageJobData } from "@aula-agente/queue";
import { getSendMessageQueue } from "@aula-agente/queue";
import { getConnectionOptions } from "../lib/redis";
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

const EVOLUTION_API_URL = () => process.env.EVOLUTION_API_URL!;
const EVOLUTION_API_KEY = () => process.env.EVOLUTION_API_KEY!;

export async function fetchMediaBase64(
  instanceName: string,
  remoteJid: string,
  messageId: string,
  messageType: string
): Promise<{ base64: string; mimeType: string }> {
  const response = await fetch(
    `${EVOLUTION_API_URL()}/chat/getBase64FromMediaMessage/${encodeURIComponent(instanceName)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: EVOLUTION_API_KEY(),
      },
      body: JSON.stringify({
        message: {
          key: { remoteJid, fromMe: false, id: messageId },
          messageType,
        },
      }),
    }
  );
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Evolution API error ${response.status}: ${text}`);
  }
  const json = (await response.json()) as { base64: string; mimetype: string };
  return { base64: json.base64, mimeType: json.mimetype };
}

export async function transcribeAudio(
  base64: string,
  mimeType: string,
  apiKey: string
): Promise<string> {
  const audioBuffer = Buffer.from(base64, "base64");
  const audioBlob = new Blob([audioBuffer], { type: mimeType });
  const formData = new FormData();
  formData.append("file", audioBlob, "audio.ogg");
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
    return { ...message, content: transcription };
  } catch (err) {
    console.warn("[process-message] Falha ao processar áudio:", (err as Error).message);
    return { ...message, content: "[Usuário enviou um áudio. Não foi possível processar.]" };
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

      // Acquire conversation lock
      const lockValue = await acquireConversationLock(conversationId);
      if (!lockValue) {
        throw new Error(`Failed to acquire lock for conversation ${conversationId}`);
      }

      try {
        const db = getAdminClient();

        // Load agent config
        const agent = await getAgentById(db, agentId);
        if (!agent.is_active) {
          console.log(`Agent ${agentId} is inactive, skipping`);
          return;
        }

        // Check if still not in human takeover
        const conversation = (await getConversationById(db, conversationId)) as Record<
          string,
          unknown
        >;
        if (conversation.is_human_takeover) {
          console.log(`Conversation ${conversationId} is in human takeover, skipping`);
          return;
        }

        // Resolve API key for this tenant
        const apiKey = await resolveApiKey(organizationId, agent.provider);

        // Load recent message history
        const recentMessages = await getRecentMessages(db, conversationId, 20);

        // Find the current message
        const currentMessage = recentMessages.find((m) => m.id === messageId);
        if (!currentMessage) {
          throw new Error(`Message ${messageId} not found`);
        }

        // Remove current message from history
        const history = recentMessages.filter((m) => m.id !== messageId);

        // Extract phone and instance early (needed for media preprocessing and sending)
        const contact = conversation.contacts as { phone: string } | null;
        if (!contact?.phone) {
          throw new Error(`Contact phone not found for conversation ${conversationId}`);
        }
        const instance = await getInstanceById(db, conversation.evolution_instance_id as string);

        // Media preprocessing
        let effectiveMessage = currentMessage;
        let imageContent: { base64: string; mimeType: string } | undefined;

        if (currentMessage.media_type === "audio") {
          effectiveMessage = await preprocessAudioMessage(
            currentMessage,
            instance.instance_name,
            contact.phone,
            agent.provider,
            apiKey
          );
        } else if (currentMessage.media_type === "image") {
          const imgResult = await preprocessImageMessage(
            currentMessage,
            instance.instance_name,
            contact.phone
          );
          if (imgResult) imageContent = imgResult;
        }

        // Run the agent
        const result = await runAgent({
          agent,
          messages: history,
          currentMessage: effectiveMessage,
          apiKey,
          organizationId,
          imageContent,
        });

        // Save agent response
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

        // Update conversation
        await updateConversation(db, conversationId, {
          last_message_at: new Date().toISOString(),
          status: "waiting",
        });

        // Enqueue send message
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
