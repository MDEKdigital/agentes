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
  setConversationWaiting,
  getInstanceById,
  workerActivateHumanTakeover,
  cancelEnrollmentsByConversation,
  updateMessageMediaUrl,
} from "@aula-agente/database";
import { fireAudit } from "../lib/audit";
import { acquireConversationLock, releaseConversationLock, renewConversationLock, LOCK_RENEWAL_INTERVAL_MS, LockContentionError } from "../lib/lock";
import { resolveApiKey } from "../lib/vault";
import { validateMediaPayload } from "../lib/media-validation";
import { runAgent } from "../agents/agent-runner";
import { salomaoDecisor } from "../agents/salomao-decisor";
import type { LeadDecision } from "../agents/salomao-decisor";
import { runSalamaoCriador } from "../agents/salomao-criador";
import { evaluateActivation } from "./evaluate-activation";
import { CLOSE_CONVERSATION_TOOL_NAME } from "../agents/tools/close-conversation";
import { HUMAN_HANDOFF_TOOL_NAME } from "../agents/tools/registry";
import { splitMessage } from "../lib/split-message";
import { workerLog } from "../lib/logger";
import { incrementMetric } from "../lib/metrics";
import { enqueueDeadLetter } from "../lib/dead-letter";

export const WHISPER_TIMEOUT_MS = 60_000;
// Each part job has delay: i * INTER_PART_DELAY_MS. Must exceed max retry backoff (fixed 2 000 ms × 2 gaps = 4 s)
// so a retrying part_0 always resolves before part_1 becomes eligible.
const INTER_PART_DELAY_MS = 7_000;

type ConversationRow = Conversation & { contacts: { phone: string } | null };

export const FALLBACK_MESSAGE =
  "Tivemos uma instabilidade técnica ao processar sua mensagem. Por favor, tente novamente em instantes.";

export function isTerminalFailure(job: {
  attemptsMade: number;
  opts?: { attempts?: number };
}): boolean {
  return job.attemptsMade >= (job.opts?.attempts ?? 1);
}

export async function handleTerminalFailure(
  jobData: ProcessMessageJobData
): Promise<void> {
  const { conversationId, messageId, organizationId } = jobData;
  try {
    const db = getAdminClient();
    const conversation = await getConversationById(db, conversationId, organizationId) as ConversationRow | null;
    if (!conversation) return;

    const instanceId = conversation.evolution_instance_id;
    if (!instanceId) return;

    const contact = conversation.contacts;
    if (!contact?.phone) return;

    const sendQueue = getSendMessageQueue();
    await sendQueue.add(
      "send-message",
      {
        conversationId,
        messageId,
        instanceId,
        phone: contact.phone,
        content: FALLBACK_MESSAGE,
        organizationId,
      },
      { jobId: `fallback_${messageId}` }
    );
    incrementMetric("process_message_terminal_fallback");
  } catch (err) {
    workerLog("process-message", "error", { messageId, conversationId, organizationId }, `terminal fallback failed err="${(err as Error).message}"`);
  }
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
    signal: AbortSignal.timeout(WHISPER_TIMEOUT_MS),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Whisper API error ${response.status}: ${text}`);
  }
  const json = (await response.json()) as { text: string };
  return json.text;
}

const IMAGE_EXTENSION_MAP: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

async function uploadMediaToStorage(
  base64: string,
  mimeType: string,
  folder: string,
  messageId: string,
  organizationId: string
): Promise<string | null> {
  try {
    const db = getAdminClient();
    const baseMime = mimeType.split(";")[0].trim();
    const ext = folder === "audio"
      ? (AUDIO_EXTENSION_MAP[baseMime] ?? "ogg")
      : (IMAGE_EXTENSION_MAP[baseMime] ?? "jpg");
    const path = `${folder}/${organizationId}/${messageId}.${ext}`;
    const buffer = Buffer.from(base64, "base64");

    const { error } = await db.storage
      .from("media")
      .upload(path, buffer, { contentType: baseMime, upsert: true });

    if (error) {
      workerLog("process-message", "warn", { messageId, organizationId }, `${folder} storage upload failed: ${error.message}`);
      return null;
    }

    const { data } = db.storage.from("media").getPublicUrl(path);
    return data.publicUrl;
  } catch (err) {
    workerLog("process-message", "warn", { messageId, organizationId }, `${folder} storage upload error: ${(err as Error).message}`);
    return null;
  }
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
    validateMediaPayload(base64, mimeType);

    // Upload audio to Storage so the attendant can play it in the inbox
    const publicUrl = await uploadMediaToStorage(base64, mimeType, "audio", message.id, message.organization_id);
    if (publicUrl) {
      const db = getAdminClient();
      await updateMessageMediaUrl(db, message.id, message.organization_id, publicUrl);
    }

    const transcription = await transcribeAudio(base64, mimeType, apiKey);
    const safeContent = `<audio_transcription>\n${transcription}\n</audio_transcription>`;
    return { message: { ...message, content: safeContent, media_type: null }, failed: false };
  } catch (err) {
    workerLog("process-message", "warn", {
      messageId: message.id,
      conversationId: message.conversation_id,
      organizationId: message.organization_id,
    }, `audio preprocessing failed err="${(err as Error).message}"`);
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
    validateMediaPayload(base64, mimeType);

    // Upload image to Storage so the attendant can see it in the inbox
    const publicUrl = await uploadMediaToStorage(base64, mimeType, "image", message.id, message.organization_id);
    if (publicUrl) {
      const db = getAdminClient();
      await updateMessageMediaUrl(db, message.id, message.organization_id, publicUrl);
    }

    return { base64, mimeType };
  } catch (err) {
    workerLog("process-message", "warn", {
      messageId: message.id,
      conversationId: message.conversation_id,
      organizationId: message.organization_id,
    }, `image fetch failed err="${(err as Error).message}"`);
    return null;
  }
}

export function startProcessMessageWorker() {
  const worker = new Worker<ProcessMessageJobData>(
    QUEUE_NAMES.PROCESS_MESSAGE,
    async (job) => {
      const { conversationId, messageId, agentId, organizationId } = job.data;
      workerLog("process-message", "info", { jobId: job.id, conversationId, messageId, organizationId }, "started");

      // RC-6: throws LockContentionError (not plain Error) so failed handler
      // can skip the terminal fallback for valid lock contention.
      const lockValue = await acquireConversationLock(conversationId);

      // RC-3: heartbeat prevents lock expiry during long LLM calls (LLM_TIMEOUT > LOCK_TTL)
      const lockHeartbeat = setInterval(() => {
        renewConversationLock(conversationId, lockValue).then((renewed) => {
          if (!renewed) {
            workerLog("process-message", "warn", { conversationId, messageId }, "lock renewal failed — lock may have been lost");
          }
        }).catch(() => {});
      }, LOCK_RENEWAL_INTERVAL_MS);

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
        if ((conversation as { is_blocked?: boolean }).is_blocked) {
          console.log(`Conversation ${conversationId} is blocked, skipping agent`);
          return;
        }
        const isPromptCreationMode = !!(conversation as { prompt_creation_mode?: boolean }).prompt_creation_mode;
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

        // PROMPT_CREATION_MODE: bypass activation gate and normal agent; route to Salomão Criador
        if (isPromptCreationMode) {
          let openaiKey: string;
          try {
            openaiKey = agent.provider === "openai" ? apiKey : await resolveApiKey(organizationId, "openai");
          } catch {
            workerLog("process-message", "error", { conversationId, messageId, organizationId }, "no OpenAI key for prompt creation mode");
            return;
          }

          const existingCriadorResponse = recentMessages.find(
            (m) => m.role === "agent" && m.metadata?.source_message_id === messageId && m.metadata?.salomao_criador
          );

          let criadorMsg: { id: string };
          let criadorContent: string;
          let deactivate = false;

          if (existingCriadorResponse) {
            criadorMsg = existingCriadorResponse;
            criadorContent = existingCriadorResponse.content;
            deactivate = !!existingCriadorResponse.metadata?.prompt_saved;
          } else {
            const result = await runSalamaoCriador({
              messages: history,
              currentMessage: effectiveMessage,
              openaiKey,
              organizationId,
            });
            criadorContent = result.text;
            if (!criadorContent?.trim()) return;

            deactivate = result.promptGenerated;
            criadorMsg = await createMessage(db, {
              conversation_id: conversationId,
              organization_id: organizationId,
              evolution_message_id: null,
              role: "agent",
              content: criadorContent,
              media_url: null,
              media_type: null,
              metadata: {
                source_message_id: messageId,
                salomao_criador: true,
                prompt_saved: result.promptGenerated,
                saved_prompt_id: result.savedPromptId ?? null,
              },
            });

            if (deactivate) {
              await db
                .from("conversations")
                .update({ prompt_creation_mode: false })
                .eq("id", conversationId)
                .eq("organization_id", organizationId);
            }
          }

          await setConversationWaiting(db, conversationId, organizationId, new Date().toISOString());

          const sendQueue = getSendMessageQueue();
          const parts = splitMessage(criadorContent);
          await Promise.all(
            parts.map((part, i) =>
              sendQueue.add(
                "send-message",
                {
                  conversationId,
                  messageId: criadorMsg.id,
                  instanceId: instance.id,
                  phone: contact.phone,
                  content: part,
                  organizationId,
                },
                { jobId: `${messageId}_criador_part_${i}`, delay: i * INTER_PART_DELAY_MS }
              )
            )
          );

          workerLog("process-message", "info", { conversationId, messageId, organizationId, deactivate: String(deactivate) }, "prompt-creation-mode handled");
          return;
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
        let wasHandoff: boolean;
        let responseContent: string;

        if (existingResponse) {
          workerLog("process-message", "info", { jobId: job.id, conversationId, messageId, organizationId }, `retry: reusing existing response ${existingResponse.id}`);
          if (!existingResponse.content?.trim()) {
            workerLog("process-message", "error", { jobId: job.id, conversationId, messageId, organizationId }, "existingResponse has empty content — conversation stuck, manual intervention required");
            throw new Error(`existingResponse ${existingResponse.id} has empty content — cannot deliver`);
          }
          responseMessage = existingResponse;
          responseContent = existingResponse.content;
          const savedToolCalls: string[] = existingResponse.metadata?.tool_calls ?? [];
          wasResolved = savedToolCalls.includes(CLOSE_CONVERSATION_TOOL_NAME);
          wasHandoff = savedToolCalls.includes(HUMAN_HANDOFF_TOOL_NAME);
        } else {
          // Salomão Decisor — classifica o lead antes do agente responder
          let leadDecision: LeadDecision | null = null;
          if (!isMediaFallback && effectiveMessage.content?.trim()) {
            try {
              leadDecision = await salomaoDecisor(effectiveMessage.content, apiKey);
              if (leadDecision) {
                workerLog("process-message", "info", {
                  conversationId,
                  messageId,
                  organizationId,
                  leadType: leadDecision.lead_type,
                  leadStage: leadDecision.stage,
                }, "salomao-decisor classified lead");
              }
            } catch (err) {
              workerLog("process-message", "warn", { conversationId, messageId }, `salomao-decisor failed: ${(err as Error).message}`);
            }
          }

          const result = await runAgent({
            agent,
            messages: history,
            currentMessage: effectiveMessage,
            apiKey,
            organizationId,
            imageContent,
            conversationId,
            contactName: (contact as { name?: string | null }).name ?? null,
            leadDecision,
          });
          responseContent = result.text;
          if (!responseContent?.trim()) {
            workerLog("process-message", "warn", { jobId: job.id, conversationId, messageId, organizationId }, "agent returned empty response — skipping DB write and delivery");
            incrementMetric("process_message_empty_response");
            return;
          }
          wasResolved = result.toolCalls.includes(CLOSE_CONVERSATION_TOOL_NAME);
          wasHandoff = result.toolCalls.includes(HUMAN_HANDOFF_TOOL_NAME);

          // Re-check takeover: human may have activated it while LLM was running.
          // If so, skip delivery — the agent's response would arrive after the human
          // already took over, confusing the contact.
          if (!wasHandoff) {
            const { data: freshConv } = await db
              .from("conversations")
              .select("is_human_takeover")
              .eq("id", conversationId)
              .eq("organization_id", organizationId)
              .single();
            if (freshConv?.is_human_takeover) {
              workerLog("process-message", "info", { jobId: job.id, conversationId, messageId }, "human takeover detected post-LLM — skipping response delivery");
              return;
            }
          }

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

        if (wasHandoff) {
          await Promise.all([
            workerActivateHumanTakeover(db, conversationId, organizationId),
            cancelEnrollmentsByConversation(db, conversationId, organizationId),
          ]);
          fireAudit(db, {
            organization_id: organizationId,
            action: "conversation.human_handoff",
            entity_type: "conversation",
            entity_id: conversationId,
            metadata: { agent_id: agentId, actor: "agent" },
          });
        } else if (wasResolved) {
          await updateConversation(db, conversationId, {
            last_message_at: new Date().toISOString(),
            status: "resolved",
          }, organizationId);
          fireAudit(db, {
            organization_id: organizationId,
            action: "conversation.resolved",
            entity_type: "conversation",
            entity_id: conversationId,
            metadata: { agent_id: agentId, actor: "system" },
          });
        } else {
          // C8: conditional update — won't overwrite "resolved" set by a concurrent human action
          await setConversationWaiting(db, conversationId, organizationId, new Date().toISOString());
        }

        const sendQueue = getSendMessageQueue();
        const parts = splitMessage(responseContent);
        // One job per part — stable jobId per part gives BullMQ per-part idempotency on retry.
        // Delay staggers delivery so parts arrive in order even with concurrent workers.
        await Promise.all(
          parts.map((part, i) =>
            sendQueue.add(
              "send-message",
              {
                conversationId,
                messageId: responseMessage.id,
                instanceId: instance.id,
                phone: contact.phone,
                content: part,
                organizationId,
              },
              { jobId: `${messageId}_agent_response_part_${i}`, delay: i * INTER_PART_DELAY_MS }
            )
          )
        );

        workerLog("process-message", "info", { jobId: job.id, conversationId, messageId, organizationId }, `completed responseId=${responseMessage.id}`);
        incrementMetric("process_message_success");
      } finally {
        clearInterval(lockHeartbeat);
        await releaseConversationLock(conversationId, lockValue);
      }
    },
    {
      connection: getConnectionOptions(),
      concurrency: 10,
      // WHISPER_TIMEOUT_MS is 60 s; runAgent can chain multiple calls. 120 s gives headroom
      // so BullMQ stall-checker never fires on a legitimately-running job.
      lockDuration: 120_000,
    }
  );

  worker.on("failed", (job, err) => {
    workerLog("process-message", "error", {
      jobId: job?.id,
      conversationId: job?.data.conversationId,
      messageId: job?.data.messageId,
      organizationId: job?.data.organizationId,
    }, `failed err="${err.message}"`);
    incrementMetric("process_message_failed");
    if (job && isTerminalFailure(job)) {
      // RC-6: lock contention is a valid operational state — do NOT send the
      // "instabilidade técnica" fallback to the user. Still dead-letter for
      // observability so the dropped message can be investigated.
      if (err instanceof LockContentionError) {
        workerLog("process-message", "warn", {
          jobId: job.id,
          conversationId: job.data.conversationId,
          messageId: job.data.messageId,
        }, "terminal lock contention — no fallback sent to user");
        enqueueDeadLetter({
          sourceQueue: QUEUE_NAMES.PROCESS_MESSAGE,
          jobId: job.id,
          identifiers: { conversationId: job.data.conversationId, messageId: job.data.messageId, organizationId: job.data.organizationId },
          attemptsMade: job.attemptsMade,
        }, err).catch((e: Error) => {
          workerLog("process-message", "error", { jobId: job.id }, `dead-letter enqueue failed err="${e.message}"`);
        });
        return;
      }
      handleTerminalFailure(job.data).catch((e: Error) => {
        workerLog("process-message", "error", { jobId: job.id, messageId: job.data.messageId }, `handleTerminalFailure threw err="${e.message}"`);
      });
      enqueueDeadLetter({
        sourceQueue: QUEUE_NAMES.PROCESS_MESSAGE,
        jobId: job.id,
        identifiers: { conversationId: job.data.conversationId, messageId: job.data.messageId, organizationId: job.data.organizationId },
        attemptsMade: job.attemptsMade,
      }, err).catch((e: Error) => {
        workerLog("process-message", "error", { jobId: job.id }, `dead-letter enqueue failed err="${e.message}"`);
      });
    }
  });

  console.log("Process-message worker started");
  return worker;
}
