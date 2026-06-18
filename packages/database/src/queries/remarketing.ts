import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  RemarketingFlow,
  RemarketingStep,
  RemarketingEnrollment,
} from "@aula-agente/shared";

const OPT_OUT_KEYWORDS = [
  "pare", "parar", "stop", "cancelar", "não quero",
  "nao quero", "chega", "sair", "remover", "descadastrar",
];

export async function getActiveRemarketingFlows(
  client: SupabaseClient
): Promise<RemarketingFlow[]> {
  const { data, error } = await client
    .from("remarketing_flows")
    .select("*")
    .eq("status", "active");
  if (error) throw error;
  return (data as RemarketingFlow[]) ?? [];
}

export async function getFirstActiveStep(
  client: SupabaseClient,
  flowId: string
): Promise<RemarketingStep | null> {
  const { data, error } = await client
    .from("remarketing_steps")
    .select("*")
    .eq("flow_id", flowId)
    .eq("is_active", true)
    .order("step_order", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data as RemarketingStep | null;
}

export async function getNextActiveStep(
  client: SupabaseClient,
  flowId: string,
  afterStepOrder: number
): Promise<RemarketingStep | null> {
  const { data, error } = await client
    .from("remarketing_steps")
    .select("*")
    .eq("flow_id", flowId)
    .eq("is_active", true)
    .gt("step_order", afterStepOrder)
    .order("step_order", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data as RemarketingStep | null;
}

export async function getConversationsEligibleForEnrollment(
  client: SupabaseClient,
  flow: RemarketingFlow
): Promise<{ id: string; organization_id: string }[]> {
  const silenceCutoff = new Date(
    Date.now() - flow.entry_silence_minutes * 60 * 1000
  ).toISOString();

  const { data: conversations, error } = await client
    .from("conversations")
    .select("id, organization_id")
    .eq("agent_id", flow.agent_id)
    .eq("evolution_instance_id", flow.instance_id)
    .eq("organization_id", flow.organization_id)
    .in("status", ["open", "waiting"]);

  if (error) throw error;
  if (!conversations || conversations.length === 0) return [];

  const { data: enrolled } = await client
    .from("remarketing_enrollments")
    .select("conversation_id")
    .in(
      "conversation_id",
      conversations.map((c) => c.id)
    )
    .eq("status", "active");

  const enrolledIds = new Set((enrolled ?? []).map((e) => e.conversation_id));
  const candidates = conversations.filter((c) => !enrolledIds.has(c.id));
  if (candidates.length === 0) return [];

  const eligible: { id: string; organization_id: string }[] = [];
  for (const conv of candidates) {
    const { count, error: msgErr } = await client
      .from("messages")
      .select("*", { count: "exact", head: true })
      .eq("conversation_id", conv.id)
      .eq("role", "contact")
      .gt("created_at", silenceCutoff);

    if (msgErr) throw msgErr;
    if (count === 0) eligible.push(conv);
  }
  return eligible;
}

export async function createEnrollment(
  client: SupabaseClient,
  data: {
    flow_id: string;
    conversation_id: string;
    organization_id: string;
    next_step_id: string;
  }
): Promise<RemarketingEnrollment> {
  const { data: enrollment, error } = await client
    .from("remarketing_enrollments")
    .insert({ ...data, status: "active" })
    .select()
    .single();
  if (error) throw error;
  return enrollment as RemarketingEnrollment;
}

export async function getActiveEnrollments(
  client: SupabaseClient
): Promise<RemarketingEnrollment[]> {
  const { data, error } = await client
    .from("remarketing_enrollments")
    .select("*")
    .eq("status", "active")
    .not("next_step_id", "is", null);
  if (error) throw error;
  return (data as RemarketingEnrollment[]) ?? [];
}

export async function getStepById(
  client: SupabaseClient,
  stepId: string
): Promise<RemarketingStep | null> {
  const { data, error } = await client
    .from("remarketing_steps")
    .select("*")
    .eq("id", stepId)
    .maybeSingle();
  if (error) throw error;
  return data as RemarketingStep | null;
}

export async function cancelEnrollment(
  client: SupabaseClient,
  enrollmentId: string,
  reason: string
): Promise<void> {
  const { error } = await client
    .from("remarketing_enrollments")
    .update({ status: "cancelled", cancel_reason: reason })
    .eq("id", enrollmentId);
  if (error) throw error;
}

export async function advanceEnrollment(
  client: SupabaseClient,
  enrollmentId: string,
  nextStepId: string | null
): Promise<void> {
  const { error } = await client
    .from("remarketing_enrollments")
    .update({
      next_step_id: nextStepId,
      last_step_sent_at: new Date().toISOString(),
      status: nextStepId === null ? "completed" : "active",
    })
    .eq("id", enrollmentId);
  if (error) throw error;
}

export async function updateFlowLastExecuted(
  client: SupabaseClient,
  flowId: string
): Promise<void> {
  const { error } = await client
    .from("remarketing_flows")
    .update({ last_executed_at: new Date().toISOString() })
    .eq("id", flowId);
  if (error) throw error;
}

export async function hasContactRepliedSince(
  client: SupabaseClient,
  conversationId: string,
  since: string
): Promise<boolean> {
  const { count, error } = await client
    .from("messages")
    .select("*", { count: "exact", head: true })
    .eq("conversation_id", conversationId)
    .eq("role", "contact")
    .gt("created_at", since);
  if (error) throw error;
  return (count ?? 0) > 0;
}

export async function getLastContactMessage(
  client: SupabaseClient,
  conversationId: string
): Promise<{ content: string } | null> {
  const { data, error } = await client
    .from("messages")
    .select("content")
    .eq("conversation_id", conversationId)
    .eq("role", "contact")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export function isOptOutMessage(content: string): boolean {
  const lower = content.toLowerCase();
  return OPT_OUT_KEYWORDS.some((kw) => lower.includes(kw));
}

export async function isConversationResolved(
  client: SupabaseClient,
  conversationId: string
): Promise<boolean> {
  const { data, error } = await client
    .from("conversations")
    .select("status")
    .eq("id", conversationId)
    .single();
  if (error) throw error;
  return data?.status === "resolved" || data?.status === "closed";
}

export async function returnConversationToAgent(
  client: SupabaseClient,
  conversationId: string,
  agentId: string
): Promise<void> {
  const { error } = await client
    .from("conversations")
    .update({ agent_id: agentId, status: "open" })
    .eq("id", conversationId);
  if (error) throw error;
}

export async function getRemarketingFlowsByIds(
  client: SupabaseClient,
  ids: string[]
): Promise<RemarketingFlow[]> {
  if (ids.length === 0) return [];
  const { data, error } = await client
    .from("remarketing_flows")
    .select("*")
    .in("id", ids);
  if (error) throw error;
  return (data as RemarketingFlow[]) ?? [];
}

export async function getRemarketingStepsByIds(
  client: SupabaseClient,
  ids: string[]
): Promise<RemarketingStep[]> {
  if (ids.length === 0) return [];
  const { data, error } = await client
    .from("remarketing_steps")
    .select("*")
    .in("id", ids);
  if (error) throw error;
  return (data as RemarketingStep[]) ?? [];
}
