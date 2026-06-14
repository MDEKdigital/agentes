import { Worker, type Job } from "bullmq";
import { QUEUE_NAMES } from "@aula-agente/shared";
import type { RemarketingJobData } from "@aula-agente/queue";
import { getRemarketingQueue } from "@aula-agente/queue";
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
} from "@aula-agente/database";

function toMinutes(value: number, unit: string): number {
  if (unit === 'hours') return value * 60;
  if (unit === 'days') return value * 60 * 24;
  return value;
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
          // Unique constraint violation: conversa já foi enrollada por execução concorrente
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
      const readyAt = new Date(reference).getTime() + toMinutes(step.delay_value, step.delay_unit) * 60 * 1000;
      if (Date.now() < readyAt) continue;

      // ── Verificar regras de cancelamento ──────────────────────────────────

      // Conversa resolvida/fechada
      const resolved = await isConversationResolved(db, enrollment.conversation_id);
      if (resolved) {
        await cancelEnrollment(db, enrollment.id, "resolved");
        console.log(`[remarketing] Cancelled enrollment ${enrollment.id}: conversation resolved`);
        continue;
      }

      // Cliente respondeu após o enrollment
      const flow = flows.find((f) => f.id === enrollment.flow_id);
      if (flow?.cancel_on_reply) {
        const replied = await hasContactRepliedSince(
          db,
          enrollment.conversation_id,
          enrollment.enrolled_at
        );
        if (replied) {
          await cancelEnrollment(db, enrollment.id, "reply");
          await returnConversationToAgent(db, enrollment.conversation_id, flow.agent_id);
          console.log(`[remarketing] Cancelled enrollment ${enrollment.id}: client replied`);
          continue;
        }
      }

      // Cliente pediu opt-out (última mensagem do contato)
      if (flow?.cancel_on_opt_out) {
        const lastMsg = await getLastContactMessage(db, enrollment.conversation_id);
        if (lastMsg && isOptOutMessage(lastMsg.content)) {
          await cancelEnrollment(db, enrollment.id, "opt_out");
          console.log(`[remarketing] Cancelled enrollment ${enrollment.id}: opt-out detected`);
          continue;
        }
      }

      // ── Enviar mensagem ────────────────────────────────────────────────────
      const { error: msgError } = await db.from("messages").insert({
        conversation_id: enrollment.conversation_id,
        organization_id: enrollment.organization_id,
        role: "agent",
        content: step.message_content,
        ...(step.message_type !== "text" && {
          media_url: step.message_content,
          media_type: step.message_type,
        }),
      });

      if (msgError) throw msgError;

      console.log(
        `[remarketing] Sent step ${step.step_order} to conversation ${enrollment.conversation_id}`
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
