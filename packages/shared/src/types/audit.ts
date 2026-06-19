export type AuditAction =
  // Agent
  | "agent.created"
  | "agent.updated"
  | "agent.deleted"
  // Member
  | "member.role_changed"
  | "member.removed"
  // Invitation
  | "invitation.sent"
  | "invitation.resent"
  // Organization
  | "organization.created"
  | "organization.updated"
  | "organization.onboarding_completed"
  | "organization.deleted"
  // Plan / billing
  | "plan.activated"
  | "plan.renewed"
  | "plan.cancelled"
  | "plan.past_due"
  | "billing.event_received"
  // Instance
  | "instance.created"
  | "instance.updated"
  | "instance.deleted"
  | "instance.restarted"
  | "instance.logged_out"
  | "instance.settings_updated"
  | "instance.privacy_updated"
  | "instance.profile_updated"
  // Knowledge
  | "faq.created"
  | "faq.updated"
  | "faq.deleted"
  | "document.uploaded"
  | "document.deleted"
  // Secrets
  | "secret.upserted"
  | "secret.deleted"
  // Remarketing flows
  | "remarketing_flow.created"
  | "remarketing_flow.updated"
  | "remarketing_flow.deleted"
  | "remarketing_flow.duplicated"
  | "remarketing_flow.status_changed"
  // Remarketing steps
  | "remarketing_step.created"
  | "remarketing_step.updated"
  | "remarketing_step.deleted"
  | "remarketing_step.status_changed"
  // Remarketing worker
  | "remarketing.enrollment_created"
  | "remarketing.enrollment_cancelled"
  | "remarketing.step_sent"
  // Conversation
  | "conversation.takeover_started"
  | "conversation.takeover_ended"
  | "conversation.takeover_expired"
  | "conversation.tags_updated"
  | "conversation.assignment_changed"
  | "conversation.status_changed"
  | "conversation.deleted"
  | "conversation.keyword_activated"
  | "conversation.resolved";

export type AuditEntityType =
  | "agent"
  | "member"
  | "invitation"
  | "conversation"
  | "organization"
  | "plan"
  | "billing_event"
  | "instance"
  | "faq"
  | "document"
  | "secret"
  | "remarketing_flow"
  | "remarketing_step"
  | "remarketing_enrollment";

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
