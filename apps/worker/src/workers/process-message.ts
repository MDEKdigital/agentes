import { Worker } from "bullmq";
import { QUEUE_NAMES } from "@aula-agente/shared";
import type { LLMProvider, Message, Conversation } from "@aula-agente/shared";
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
import { fireAudit } from "../lib/audit";
import { acquireConversationLock, releaseConversationLock } from "../lib/lock";
import { resolveApiKey } from "../lib/vault";
import { runAgent } from "../agents/agent-runner";
import { evaluateActivation } from "./evaluate-activation";
import { CLOSE_CONVERSATION_TOOL_NAME } from "../agents/tools/close-conversation";

type ConversationRow = Conversation & { contacts: { phone: string } | null };

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
): Promise<{ message: Message; failed: boolean }> {
  if (!message.evolution_message_id) return { message, failed: false };

  const remoteJid = `${phone}@s.whatsapp.net`;

  if (provider !== "openai") {
    return {
      message: {
        ...message,
        content: "[Usuário enviou um áudio. Transcrição não disponível para este agente.]",
        media_type: null,
      },
      failed: true,
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
    return { message: { ...message, content: transcription, media_type: null }, failed: false };
  } catch (err) {
    console.warn("[process-message] Falha ao processar áudio:", (err as Error).message);
    return {
      message: {
        ...message,
        content: "[Usuário enviou um áudio. Não foi possível processar.]",
        media_type: null,
      },
      failed: true,
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

        // Fix #9: Parallelize agent + conversation fetch
        const [agent, conversation] = (await Promise.all([
          getAgentById(db, agentId, organizationId),
          getConversationById(db, conversationId, organizationId),
        ])) as [Awaited<ReturnType<typeof getAgentById>>, ConversationRow];

        if (!agent) {
          console.log(`Agent ${agentId} not found in org ${organizationId}, skipping`);
          return;
        }

        if (!agent.is_active) {
          console.log(`Agent ${agentId} is inactive, skipping`);
          return;
        }
        if (conversation.is_human_takeover) {
          console.log(`Conversation ${conversationId} is in human takeover, skipping`);
          return;
        }
        if ((conversation as { status?: string }).status === "resolved") {
          console.log(`Conversation ${conversationId} already resolved, skipping retry`);
          return;
        }

        const contact = conversation.contacts;
        if (!contact?.phone) {
          throw new Error(`Contact phone not found for conversation ${conversationId}`);
        }
        const evolutionInstanceId = conversation.evolution_instance_id;
        if (!evolutionInstanceId) {
          throw new Error(`Conversation ${conversationId} has no evolution_instance_id`);
        }

        // Fix #9 + #8: Parallelize apiKey + recentMessages + instance (always fetched up front)
        const [apiKey, recentMessages, instance] = await Promise.all([
          resolveApiKey(organizationId, agent.provider),
          getRecentMessages(db, conversationId, organizationId, 20),
          getInstanceById(db, evolutionInstanceId, organizationId),
        ]);

        const currentMessage = recentMessages.find((m) => m.id === messageId);
        if (!currentMessage) {
          throw new Error(`Message ${messageId} not found`);
        }

        const history = recentMessages.filter((m) => m.id !== messageId);

        let effectiveMessage = currentMessage;
        let imageContent: { base64: string; mimeType: string } | undefined;
        let isMediaFallback = false;

        if (currentMessage.media_type === "audio") {
          const { message: processed, failed } = await preprocessAudioMessage(
            currentMessage,
            instance.instance_name,
            contact.phone,
            agent.provider,
            apiKey
          );
          effectiveMessage = processed;
          isMediaFallback = failed;
        } else if (currentMessage.media_type === "image") {
          const imgResult = await preprocessImageMessage(
            currentMessage,
            instance.instance_name,
            contact.phone
          );
          if (imgResult) {
            imageContent = imgResult;
          } else {
            isMediaFallback = true;
            effectiveMessage = {
              ...currentMessage,
              content: "[Usuário enviou uma imagem. Não foi possível carregar para processamento.]",
              media_type: null,
            };
          }
        }

        // Activation gate — runs after preprocessing so audio content is matched
        // against transcribed text, not raw placeholders.
        let activatesKeyword = false;
        if (agent.activation_rules.length > 0 && !conversation.is_keyword_activated) {
          if (isMediaFallback) {
            console.log(`[activation-gate] Conversa ${conversationId} — mídia sem transcrição, ignorando`);
            return;
          }

          const evalResult = await evaluateActivation({
            messageContent: effectiveMessage.content,
            activationRules: agent.activation_rules,
            provider: agent.provider,
            apiKey,
            awaitingConfirmation: conversation.awaiting_activation_confirmation,
          });

          if (evalResult.action === "ignore") {
            console.log(`[activation-gate] Conversa ${conversationId} — nenhuma regra ativada, ignorando`);
            return;
          }

          if (evalResult.action === "confirm") {
            console.log(`[activation-gate] Conversa ${conversationId} — confiança baixa, solicitando confirmação`);

            // C14 idempotency: reuse existing confirmation on retry so no duplicate DB record
            const existingConfirmation = recentMessages.find(
              (m) =>
                m.role === "agent" &&
                m.metadata?.source_message_id === messageId &&
                m.metadata?.type === "activation_confirmation"
            );

            let confirmMsg: { id: string };
            if (existingConfirmation) {
              confirmMsg = existingConfirmation;
            } else {
              confirmMsg = await createMessage(db, {
                conversation_id: conversationId,
                organization_id: organizationId,
                evolution_message_id: null,
                role: "agent",
                content: evalResult.confirmationMessage,
                media_url: null,
                media_type: null,
                metadata: {
                  source_message_id: messageId,
                  type: "activation_confirmation",
                },
              });
            }
            // Always idempotent: ensures state is consistent even if first run crashed mid-way
            await updateConversation(db, conversationId, {
              awaiting_activation_confirmation: true,
              last_message_at: new Date().toISOString(),
            }, organizationId);
            const sendQueue = getSendMessageQueue();
            await sendQueue.add("send-message", {
              conversationId,
              messageId: confirmMsg.id,
              instanceId: instance.id,
              phone: contact.phone,
              content: evalResult.confirmationMessage,
              organizationId,
            }, { jobId: `${messageId}_confirmation` });
            return;
          }

          // action === "activate"
          activatesKeyword = true;
          console.log(`[activation-gate] Conversa ${conversationId} ativada`);
        }

        // Commit activation before runAgent so BullMQ retries are idempotent.
        if (activatesKeyword) {
          await updateConversation(db, conversationId, {
            is_keyword_activated: true,
            awaiting_activation_confirmation: false,
          }, organizationId);
          fireAudit(db, {
            organization_id: organizationId,
            action: "conversation.keyword_activated",
            entity_type: "conversation",
            entity_id: conversationId,
            metadata: { agent_id: agentId, actor: "system" },
          });
        }

        // C1 idempotency: if a response already exists for this trigger message, reuse it so
        // a retry cannot call runAgent() again and produce a duplicate reply.
        const existingResponse = recentMessages.find(
          (m) => m.role === "agent" && m.metadata?.source_message_id === messageId
        );

        let responseMessage: { id: string };
        let wasResolved: boolean;
        let responseContent: string;

        if (existingResponse) {
          console.log(`[process-message] Retry: reusing existing response ${existingResponse.id} for message ${messageId}`);
          responseMessage = existingResponse;
          responseContent = existingResponse.content;
          wasResolved = (existingResponse.metadata?.tool_calls ?? []).includes(CLOSE_CONVERSATION_TOOL_NAME);
        } else {
          const result = await runAgent({
            agent,
            messages: history,
            currentMessage: effectiveMessage,
            apiKey,
            organizationId,
            imageContent,
            conversationId,
          });
          responseContent = result.text;
          wasResolved = result.toolCalls.includes(CLOSE_CONVERSATION_TOOL_NAME);
          responseMessage = await createMessage(db, {
            conversation_id: conversationId,
            organization_id: organizationId,
            evolution_message_id: null,
            role: "agent",
            content: result.text,
            media_url: null,
            media_type: null,
            metadata: {
              source_message_id: messageId,
              model: result.model,
              tokens_used: result.tokensUsed,
              latency_ms: result.latencyMs,
              tool_calls: result.toolCalls,
            },
          });
        }

        await updateConversation(db, conversationId, {
          last_message_at: new Date().toISOString(),
          status: wasResolved ? "resolved" : "waiting",
          // is_keyword_activated already committed above when needed
        }, organizationId);

        if (wasResolved) {
          fireAudit(db, {
            organization_id: organizationId,
            action: "conversation.resolved",
            entity_type: "conversation",
            entity_id: conversationId,
            metadata: { agent_id: agentId, actor: "system" },
          });
        }

        const sendQueue = getSendMessageQueue();
        // Stable jobId prevents duplicate WhatsApp delivery when retry hits the queue add twice
        await sendQueue.add("send-message", {
          conversationId,
          messageId: responseMessage.id,
          instanceId: instance.id,
          phone: contact.phone,
          content: responseContent,
          organizationId,
        }, { jobId: `${messageId}_agent_response` });

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
