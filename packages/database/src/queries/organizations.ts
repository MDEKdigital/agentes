import type { SupabaseClient } from "@supabase/supabase-js";
import type { Organization, OrganizationMember, OrganizationInvitation, MemberRole } from "@aula-agente/shared";

export async function getOrganizationById(client: SupabaseClient, id: string) {
  const { data, error } = await client
    .from("organizations")
    .select("*")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data as Organization;
}

export async function getOrganizationBySlug(client: SupabaseClient, slug: string) {
  const { data, error } = await client
    .from("organizations")
    .select("*")
    .eq("slug", slug)
    .single();
  if (error) throw error;
  return data as Organization;
}

export async function getOrganizationMembers(client: SupabaseClient, organizationId: string) {
  const { data, error } = await client
    .from("organization_members")
    .select("*")
    .eq("organization_id", organizationId);
  if (error) throw error;
  return data as OrganizationMember[];
}

export async function getUserOrganizations(client: SupabaseClient, userId: string) {
  const { data, error } = await client
    .from("organization_members")
    .select("*, organizations(*)")
    .eq("user_id", userId);
  if (error) throw error;
  return data;
}

export async function createOrganization(
  client: SupabaseClient,
  org: Pick<Organization, "name" | "slug" | "plan" | "settings">,
  userId: string
) {
  const { data: orgData, error: orgError } = await client
    .from("organizations")
    .insert(org)
    .select()
    .single();
  if (orgError) throw orgError;

  const { error: memberError } = await client.from("organization_members").insert({
    organization_id: orgData.id,
    user_id: userId,
    role: "owner",
  });
  if (memberError) {
    // Best-effort rollback: delete the org we just created to avoid an ownerless org
    await client.from("organizations").delete().eq("id", orgData.id);
    throw memberError;
  }

  return orgData as Organization;
}

export async function isSlugAvailableForOrg(
  client: SupabaseClient,
  slug: string,
  excludeOrgId: string
): Promise<boolean> {
  const { data } = await client
    .from("organizations")
    .select("id")
    .eq("slug", slug)
    .neq("id", excludeOrgId)
    .maybeSingle();
  return data === null;
}

export async function completeOrganizationOnboarding(
  client: SupabaseClient,
  orgId: string,
  name: string,
  slug: string
): Promise<Organization> {
  const { data, error } = await client
    .from("organizations")
    .update({
      name,
      slug,
      // activates billing orgs that are still pending; no-op for already-active orgs
      onboarding_status: "active",
    })
    .eq("id", orgId)
    .select()
    .single();
  if (error) throw error;
  return data as Organization;
}

export async function getOrgMembersWithEmail(
  client: SupabaseClient,
  organizationId: string
): Promise<Array<{ id: string; user_id: string; email: string; role: string; created_at: string }>> {
  const { data, error } = await client.rpc("get_org_members_with_email", {
    p_org_id: organizationId,
  });
  if (error) throw error;
  return data ?? [];
}

export async function getOrgInvitations(
  client: SupabaseClient,
  organizationId: string
): Promise<OrganizationInvitation[]> {
  const { data, error } = await client
    .from("organization_invitations")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as OrganizationInvitation[];
}

export async function getMemberById(
  client: SupabaseClient,
  organizationId: string,
  memberId: string
): Promise<OrganizationMember | null> {
  const { data, error } = await client
    .from("organization_members")
    .select("*")
    .eq("id", memberId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) throw error;
  return data as OrganizationMember | null;
}

export async function updateMemberRole(
  client: SupabaseClient,
  organizationId: string,
  memberId: string,
  role: MemberRole
): Promise<OrganizationMember> {
  const { data, error } = await client
    .from("organization_members")
    .update({ role })
    .eq("id", memberId)
    .eq("organization_id", organizationId)
    .select()
    .single();
  if (error) throw error;
  return data as OrganizationMember;
}

export async function removeMember(
  client: SupabaseClient,
  organizationId: string,
  memberId: string
): Promise<void> {
  const { error } = await client
    .from("organization_members")
    .delete()
    .eq("id", memberId)
    .eq("organization_id", organizationId);
  if (error) throw error;
}

export async function createInvitation(
  client: SupabaseClient,
  invitation: Pick<OrganizationInvitation, "organization_id" | "email" | "role" | "invited_by">
) {
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await client
    .from("organization_invitations")
    .insert({ ...invitation, status: "pending", expires_at: expiresAt })
    .select()
    .single();
  if (error) throw error;
  return data as OrganizationInvitation;
}
