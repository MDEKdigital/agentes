export type BillingGateway = "stripe" | "mercadopago" | "hotmart" | "kiwify" | "eduzz";

export type BillingEventType =
  | "subscription.activated"
  | "subscription.renewed"
  | "subscription.cancelled"
  | "subscription.past_due"
  | "subscription.reactivated"
  | "refund.processed"
  | "unknown";

export type BillingEventStatus = "pending" | "processing" | "processed" | "failed" | "ignored";

export type SubscriptionStatus = "active" | "past_due" | "cancelled" | "trial" | "paused";

export type BillingInterval = "monthly" | "yearly" | "lifetime" | "manual";

export type OnboardingStatus = "pending_owner" | "active" | "suspended";

export interface Plan {
  id: string;
  name: string;
  slug: string;
  price_monthly: number;
  price_yearly: number;
  currency: string;
  max_agents: number;
  max_instances: number;
  max_members: number;
  features: string[];
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface PlanGatewayMapping {
  id: string;
  plan_id: string;
  gateway: BillingGateway;
  gateway_product_id: string;
  billing_interval: BillingInterval;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Subscription {
  id: string;
  organization_id: string;
  plan_id: string;
  status: SubscriptionStatus;
  billing_interval: BillingInterval;
  gateway: BillingGateway | null;
  gateway_subscription_id: string | null;
  gateway_customer_id: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  trial_end: string | null;
  cancelled_at: string | null;
  cancel_at_period_end: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface NormalizedBillingEvent {
  event_type: BillingEventType;
  gateway: BillingGateway;
  gateway_event_id: string;
  customer: {
    email: string;
    name: string;
    document?: string;
    phone?: string;
  };
  product: {
    gateway_product_id: string;
    gateway_plan_id?: string;
    name: string;
    plan_slug?: string; // resolved by worker via DB lookup
  };
  subscription?: {
    gateway_subscription_id: string;
    gateway_customer_id?: string;
    interval: BillingInterval;
    current_period_start?: string;
    current_period_end?: string;
  };
  amount?: number; // in cents
  currency?: string;
  metadata: Record<string, unknown>;
}

export interface BillingEvent {
  id: string;
  idempotency_key: string;
  gateway: BillingGateway | "manual";
  gateway_event_id: string;
  event_type: BillingEventType;
  raw_payload: Record<string, unknown>;
  normalized_payload: Record<string, unknown>;
  status: BillingEventStatus;
  organization_id: string | null;
  subscription_id: string | null;
  error_message: string | null;
  processed_at: string | null;
  created_at: string;
  updated_at: string;
}
