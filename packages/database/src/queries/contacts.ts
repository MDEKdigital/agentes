import type { SupabaseClient } from "@supabase/supabase-js";
import type { Contact } from "@aula-agente/shared";

export async function upsertContact(
  client: SupabaseClient,
  organizationId: string,
  phone: string,
  name: string | null,
  photoUrl: string | null
) {
  // Only include name/photo_url in the upsert when non-null so that subsequent
  // messages that arrive without pushName don't overwrite the name we already stored.
  const payload: Record<string, unknown> = { organization_id: organizationId, phone };
  if (name !== null) payload.name = name;
  if (photoUrl !== null) payload.photo_url = photoUrl;

  const { data, error } = await client
    .from("contacts")
    .upsert(payload, { onConflict: "organization_id,phone" })
    .select()
    .single();
  if (error) throw error;
  return data as Contact;
}

export async function getContactById(client: SupabaseClient, id: string) {
  const { data, error } = await client.from("contacts").select("*").eq("id", id).single();
  if (error) throw error;
  return data as Contact;
}

export async function getContactsByOrganization(
  client: SupabaseClient,
  organizationId: string,
  limit = 200
) {
  const { data, error } = await client
    .from("contacts")
    .select(`
      *,
      conversations(id, status, created_at, updated_at)
    `)
    .eq("organization_id", organizationId)
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data as (Contact & { conversations: { id: string; status: string; created_at: string; updated_at: string }[] })[];
}
