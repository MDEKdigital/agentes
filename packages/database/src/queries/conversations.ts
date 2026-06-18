import type { SupabaseClient } from "@supabase/supabase-js";
import type { Conversation, ConversationNote, ConversationMetrics } from "@aula-agente/shared";

export async function getConversationsByOrganization(
  client: SupabaseClient,
  organizationId: string,
  status?: string
) {
  let query = client
    .from("conversations")
    .select("*, contacts(*)")
    .eq("organization_id", organizationId)
    .order("last_message_at", { ascending: false });

  if (status) {
    query = query.eq("status", status);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function getConversationById(client: SupabaseClient, id: string) {
  const { data, error } = await client
    .from("conversations")
    .select("*, contacts(*), agents(name)")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data;
}

export async function findReopenableConversation(
  client: SupabaseClient,
  contactId: string,
  agentId: string
) {
  const { data, error } = await client
    .from("conversations")
    .select("*")
    .eq("contact_id", contactId)
    .eq("agent_id", agentId)
    .in("status", ["open", "waiting", "resolved"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data as Conversation | null;
}

export async function reopenConversation(
  client: SupabaseClient,
  id: string
): Promise<Conversation> {
  const { data, error } = await client
    .from("conversations")
    .update({ status: "open" })
    .eq("id", id)
    .eq("status", "resolved")
    .select()
    .maybeSingle();
  if (error) throw error;
  if (data) return data as Conversation;
  // Concurrent request already reopened — return current state
  return getConversationById(client, id);
}

export async function createConversation(
  client: SupabaseClient,
  conversation: Omit<Conversation, "id" | "created_at" | "updated_at">
) {
  const { data, error } = await client
    .from("conversations")
    .insert(conversation)
    .select()
    .single();
  if (error) throw error;
  return data as Conversation;
}

export async function updateConversation(
  client: SupabaseClient,
  id: string,
  updates: Partial<Conversation>
) {
  const { data, error } = await client
    .from("conversations")
    .update(updates)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as Conversation;
}

export async function getExpiredTakeovers(client: SupabaseClient, timeoutMs: number) {
  const cutoff = new Date(Date.now() - timeoutMs).toISOString();
  const { data, error } = await client
    .from("conversations")
    .select("*")
    .eq("is_human_takeover", true)
    .lt("human_takeover_at", cutoff)
    .limit(200);
  if (error) throw error;
  return data as Conversation[];
}

export async function addConversationNote(
  client: SupabaseClient,
  note: Omit<ConversationNote, "id" | "created_at" | "updated_at">
) {
  const { data, error } = await client
    .from("conversation_notes")
    .insert(note)
    .select()
    .single();
  if (error) throw error;
  return data as ConversationNote;
}

export async function getConversationNotes(client: SupabaseClient, conversationId: string) {
  const { data, error } = await client
    .from("conversation_notes")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data as ConversationNote[];
}

export async function updateConversationTags(
  client: SupabaseClient,
  conversationId: string,
  tags: string[]
) {
  const { error } = await client
    .from("conversations")
    .update({ tags })
    .eq("id", conversationId);
  if (error) throw error;
}

export async function resetAgentConversationsKeywordActivation(
  client: SupabaseClient,
  agentId: string,
  isKeywordActivated: boolean
) {
  const { error } = await client
    .from("conversations")
    .update({ is_keyword_activated: isKeywordActivated, awaiting_activation_confirmation: false })
    .eq("agent_id", agentId)
    .in("status", ["open", "waiting"]);
  if (error) throw error;
}
