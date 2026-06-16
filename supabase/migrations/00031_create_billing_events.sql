-- ─── billing_events ───────────────────────────────────────────────────────────
CREATE TABLE billing_events (
  id                 uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  idempotency_key    text NOT NULL UNIQUE,
  gateway            text NOT NULL
                       CHECK (gateway IN ('stripe', 'mercadopago', 'hotmart', 'kiwify', 'eduzz', 'manual')),
  gateway_event_id   text NOT NULL,
  event_type         text NOT NULL
                       CHECK (event_type IN (
                         'subscription.activated',
                         'subscription.renewed',
                         'subscription.cancelled',
                         'subscription.past_due',
                         'subscription.reactivated',
                         'refund.processed',
                         'unknown'
                       )),
  raw_payload        jsonb NOT NULL DEFAULT '{}'::jsonb,
  normalized_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status             text NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'processing', 'processed', 'failed', 'ignored')),
  organization_id    uuid REFERENCES organizations(id) ON DELETE SET NULL,
  subscription_id    uuid REFERENCES subscriptions(id) ON DELETE SET NULL,
  error_message      text,
  processed_at       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (gateway, gateway_event_id)
);

CREATE TRIGGER trg_billing_events_updated_at
  BEFORE UPDATE ON billing_events
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX idx_billing_events_idempotency ON billing_events (idempotency_key);
CREATE INDEX idx_billing_events_status      ON billing_events (status);
CREATE INDEX idx_billing_events_gateway     ON billing_events (gateway, gateway_event_id);
CREATE INDEX idx_billing_events_created     ON billing_events (created_at DESC);
CREATE INDEX idx_billing_events_org         ON billing_events (organization_id)
  WHERE organization_id IS NOT NULL;

-- ─── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE billing_events ENABLE ROW LEVEL SECURITY;

-- Apenas owner/admin da org referenciada pode ver os eventos de billing
CREATE POLICY "billing_events_select" ON billing_events
  FOR SELECT USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  );
