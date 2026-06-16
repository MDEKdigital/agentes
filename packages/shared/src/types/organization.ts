export type OrganizationPlan = "free" | "pro" | "enterprise";

export type MemberRole = "owner" | "admin" | "agent";

export type InvitationStatus = "pending" | "accepted" | "expired";

export interface Organization {
  id: string;
  name: string;
  slug: string;
  plan: OrganizationPlan;
  plan_id: string | null;
  onboarding_status: "pending_owner" | "active" | "suspended";
  settings: OrganizationSettings;
  created_at: string;
  updated_at: string;
}

export interface OrganizationSettings {
  max_documents: number;
  max_agents: number;
  max_instances: number;
}

export interface OrganizationMember {
  id: string;
  organization_id: string;
  user_id: string;
  role: MemberRole;
  created_at: string;
  updated_at: string;
}

export interface OrganizationInvitation {
  id: string;
  organization_id: string;
  email: string;
  role: MemberRole;
  invited_by: string | null;
  status: InvitationStatus;
  expires_at: string;
  accepted_at: string | null;
  accepted_by_user_id: string | null;
  created_at: string;
}

export interface OrganizationSecret {
  id: string;
  organization_id: string;
  provider: LLMProvider;
  encrypted_key: string;
  created_at: string;
  updated_at: string;
}

export type LLMProvider = "openai" | "anthropic" | "google";
