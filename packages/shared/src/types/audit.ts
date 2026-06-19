export type AuditAction =
  | "agent.created"
  | "agent.updated"
  | "agent.deleted"
  | "member.role_changed"
  | "member.removed"
  | "invitation.sent"
  | "invitation.resent"
  | "conversation.takeover_started"
  | "conversation.takeover_ended"
  | "organization.created"
  | "organization.updated"
  | "organization.onboarding_completed"
  | "organization.deleted"
  | "plan.activated"
  | "plan.renewed"
  | "plan.cancelled"
  | "plan.past_due"
  | "billing.event_received";

export type AuditEntityType =
  | "agent"
  | "member"
  | "invitation"
  | "conversation"
  | "organization"
  | "plan"
  | "billing_event";

export interface AuditLog {
  id: string;
  organization_id: string | null;
  user_id: string | null;
  action: AuditAction;
  entity_type: AuditEntityType;
  entity_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface CreateAuditLogParams {
  organization_id?: string | null;
  user_id?: string | null;
  action: AuditAction;
  entity_type: AuditEntityType;
  entity_id?: string | null;
  metadata?: Record<string, unknown>;
}
