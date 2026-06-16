-- ─── subscriptions ────────────────────────────────────────────────────────────
CREATE TABLE subscriptions (
  id                      uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id         uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  plan_id                 uuid NOT NULL REFERENCES plans(id),
  status                  text NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active', 'past_due', 'cancelled', 'trial', 'paused')),
  billing_interval        text NOT NULL DEFAULT 'monthly'
                            CHECK (billing_interval IN ('monthly', 'yearly', 'lifetime', 'manual')),
  gateway                 text
                            CHECK (gateway IN ('stripe', 'mercadopago', 'hotmart', 'kiwify', 'eduzz')),
  gateway_subscription_id text,
  gateway_customer_id     text,
  current_period_start    timestamptz,
  current_period_end      timestamptz,
  trial_end               timestamptz,
  cancelled_at            timestamptz,
  cancel_at_period_end    boolean NOT NULL DEFAULT false,
  metadata                jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id)
);

CREATE TRIGGER trg_subscriptions_updated_at
  BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX idx_subscriptions_org     ON subscriptions (organization_id);
CREATE INDEX idx_subscriptions_status  ON subscriptions (status);
CREATE INDEX idx_subscriptions_gateway ON subscriptions (gateway, gateway_subscription_id)
  WHERE gateway IS NOT NULL;

-- ─── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

-- Membros da org podem ver a própria subscription
CREATE POLICY "subscriptions_select" ON subscriptions
  FOR SELECT USING (organization_id IN (SELECT get_user_org_ids()));
