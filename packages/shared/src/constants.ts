export const MAX_DOCUMENT_SIZE_BYTES = 50 * 1024 * 1024; // 50MB

export const ALLOWED_DOCUMENT_TYPES = ["pdf", "txt", "md", "docx", "csv"] as const;

export const ALLOWED_DOCUMENT_MIME_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  csv: "text/csv",
};

export const CONVERSATION_STATUSES = ["open", "waiting", "resolved", "closed"] as const;

export const MESSAGE_ROLES = ["contact", "agent", "human_agent", "system"] as const;

export const MEMBER_ROLES = ["owner", "admin", "agent"] as const;

export const LLM_PROVIDERS = ["openai", "anthropic", "google"] as const;

export const INSTANCE_STATUSES = ["connected", "disconnected", "connecting"] as const;

export const HUMAN_TAKEOVER_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

export const EMBEDDING_DIMENSION = 1536;

export const DEFAULT_AGENT_SETTINGS = {
  temperature: 0.7,
  max_tokens: 1024,
  max_steps: 5,
  model: "gpt-4o-mini",
  provider: "openai" as const,
};

export const QUEUE_NAMES = {
  PROCESS_MESSAGE: "process-message",
  SEND_MESSAGE: "send-message",
  PROCESS_DOCUMENT: "process-document",
  TAKEOVER_TIMEOUT: "takeover-timeout",
  REMARKETING: "remarketing",
  BILLING_ONBOARDING: "billing-onboarding",
} as const;

export const BILLING_GATEWAYS = ["stripe", "mercadopago", "hotmart", "kiwify", "eduzz"] as const;

export const SUBSCRIPTION_STATUSES = ["active", "past_due", "cancelled", "trial", "paused"] as const;

export const BILLING_EVENT_STATUSES = ["pending", "processing", "processed", "failed", "ignored"] as const;

export const BILLING_EVENT_TYPES = [
  "subscription.activated",
  "subscription.renewed",
  "subscription.cancelled",
  "subscription.past_due",
  "subscription.reactivated",
  "refund.processed",
  "unknown",
] as const;

export const ONBOARDING_STATUSES = ["pending_owner", "active", "suspended"] as const;

export const BILLING_INTERVALS = ["monthly", "yearly", "lifetime", "manual"] as const;
