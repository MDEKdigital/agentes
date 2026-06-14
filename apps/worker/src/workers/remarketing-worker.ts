import { Worker, type Job } from "bullmq";
import { QUEUE_NAMES } from "@aula-agente/shared";
import type { RemarketingJobData } from "@aula-agente/queue";
import { getRemarketingQueue, getSendMessageQueue } from "@aula-agente/queue";
import { getConnectionOptions } from "../lib/redis";
import {
  getAdminClient,
  getActiveRemarketingFlows,
  getFirstActiveStep,
  getNextActiveStep,
  getConversationsEligibleForEnrollment,
  createEnrollment,
  getActiveEnrollments,
  getStepById,
  cancelEnrollment,
  advanceEnrollment,
  updateFlowLastExecuted,
  hasContactRepliedSince,
  getLastContactMessage,
  isOptOutMessage,
  isConversationResolved,
  returnConversationToAgent,
  getConversationById,
} from "@aula-agente/database";

function toMinutes(value: number, unit: string): number {
  if (unit === "hours") return value * 60;
  if (unit === "days") return value * 60 * 24;
  return value;
}

async function getFlowById(db: ReturnType<typeof getAdminClient>, flowId: string) {
  const { data } = await db
    .from("remarketing_flows")
    .select("*")
    .eq("id", flowId)
    .maybeSingle();
  return data;
}

async function processRemarketingCycle() {
  const db = getAdminClient();

  // ── Passo 1: Detectar novas entradas ──────────────────────────────────────
  const flows = await getActiveRemarketingFlows(db);

  for (const flow of flows) {
    try {
      const eligible = await getConversationsEligibleForEnrollment(db, flow);
      for (const conv of eligible) {
        const firstStep = await getFirstActiveStep(db, flow.id);
        if (!firstStep) continue;
        try {
          await createEnrollment(db, {
            flow_id: flow.id,
            conversation_id: conv.id,
            organization_id: conv.organization_id,
            next_step_id: firstStep.id,
          });
          console.log(`[remarketing] Enrolled conversation ${conv.id} in flow ${flow.id}`);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes("unique") || msg.includes("duplicate")) {
            console.log(`[remarketing] Skipping duplicate enrollment for conversation ${conv.id}`);
          } else {
            throw err;
          }
        }
      }
    } catch (err) {
      console.error(`[remarketing] Error processing flow ${flow.id}:`, err);
    }
  }

  // ── Passo 2: Processar etapas pendentes ───────────────────────────────────
  const enrollments = await getActiveEnrollments(db);

  for (const enrollment of enrollments) {
    try {
      if (!enrollment.next_step_id) continue;

      const step = await getStepById(db, enrollment.next_step_id);
      if (!step) {
        await cancelEnrollment(db, enrollment.id, "step_not_found");
        continue;
      }

      // Verificar timer
      const reference = enrollment.last_step_sent_at ?? enrollment.enrolled_at;
      const readyAt =
        new Date(reference).getTime() +
        toMinutes(step.delay_value, step.delay_unit) * 60 * 1000;
      if (Date.now() < readyAt) continue;

      // Buscar o fluxo diretamente do banco para ter dados sempre atualizados
      // (o array `flows` do Passo 1 só contém fluxos ativos no momento da varredura)
      const flow = await getFlowById(db, enrollment.flow_id);

      // ── Verificar regras de cancelamento ──────────────────────────────────

      const resolved = await isConversationResolved(db, enrollment.conversation_id);
      if (resolved) {
        await cancelEnrollment(db, enrollment.id, "resolved");
        console.log(`[remarketing] Cancelled enrollment ${enrollment.id}: conversation resolved`);
        continue;
      }

      if (flow?.cancel_on_reply) {
        const replied = await hasContactRepliedSince(
          db,
          enrollment.conversation_id,
          enrollment.enrolled_at
        );
        if (replied) {
          await cancelEnrollment(db, enrollment.id, "reply");
          if (flow.agent_id) {
            await returnConversationToAgent(db, enrollment.conversation_id, flow.agent_id);
          }
          console.log(`[remarketing] Cancelled enrollment ${enrollment.id}: client replied`);
          continue;
        }
      }

      if (flow?.cancel_on_opt_out) {
        const lastMsg = await getLastContactMessage(db, enrollment.conversation_id);
        if (lastMsg && isOptOutMessage(lastMsg.content)) {
          await cancelEnrollment(db, enrollment.id, "opt_out");
          console.log(`[remarketing] Cancelled enrollment ${enrollment.id}: opt-out detected`);
          continue;
        }
      }

      // ── Buscar conversa e telefone do contato ─────────────────────────────
      const conversation = await getConversationById(db, enrollment.conversation_id);
      if (!conversation) {
        console.error(`[remarketing] Conversation ${enrollment.conversation_id} not found, skipping`);
        continue;
      }

      const contact = conversation.contacts as { phone: string } | null;
      if (!contact?.phone) {
        console.error(`[remarketing] No phone for conversation ${enrollment.conversation_id}, skipping`);
        continue;
      }

      const instanceId = flow?.instance_id;
      if (!instanceId) {
        console.error(`[remarketing] No instance_id for flow ${enrollment.flow_id}, skipping`);
        continue;
      }

      // ── Inserir mensagem no histórico ──────────────────────────────────────
      const { data: insertedMsg, error: msgError } = await db
        .from("messages")
        .insert({
          conversation_id: enrollment.conversation_id,
          organization_id: enrollment.organization_id,
          role: "agent",
          content: step.message_content,
          media_url: step.message_type !== "text" ? step.message_content : null,
          media_type: step.message_type !== "text" ? step.message_type : null,
        })
        .select("id")
        .single();

      if (msgError) throw msgError;

      // ── Enfileirar envio real via WhatsApp ────────────────────────────────
      const sendQueue = getSendMessageQueue();
      await sendQueue.add("send-message", {
        conversationId: enrollment.conversation_id,
        messageId: insertedMsg.id,
        instanceId,
        phone: contact.phone,
        content: step.message_content,
        organizationId: enrollment.organization_id,
      });

      console.log(
        `[remarketing] Queued step ${step.step_order} → conversation ${enrollment.conversation_id} (phone ${contact.phone})`
      );

      // ── Avançar para próxima etapa ─────────────────────────────────────────
      const nextStep = await getNextActiveStep(db, enrollment.flow_id, step.step_order);
      await advanceEnrollment(db, enrollment.id, nextStep?.id ?? null);
      await updateFlowLastExecuted(db, enrollment.flow_id);
    } catch (err) {
      console.error(`[remarketing] Error processing enrollment ${enrollment.id}:`, err);
    }
  }
}

export function startRemarketingWorker() {
  const worker = new Worker<RemarketingJobData>(
    QUEUE_NAMES.REMARKETING,
    async (_job: Job) => {
      await processRemarketingCycle();
    },
    {
      connection: getConnectionOptions(),
      concurrency: 1,
    }
  );

  const queue = getRemarketingQueue();
  queue.upsertJobScheduler(
    "remarketing-scheduler",
    { every: 60 * 1000 },
    { name: "check-remarketing" }
  );

  worker.on("failed", (job, err) => {
    console.error(`[remarketing] Job ${job?.id} failed:`, err.message);
  });

  console.log("Remarketing worker started (runs every 1 min)");
  return worker;
}
