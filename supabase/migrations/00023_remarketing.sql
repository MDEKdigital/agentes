-- ─── remarketing_flows ────────────────────────────────────────────────────────
CREATE TABLE remarketing_flows (
  id                     uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id        uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name                   text NOT NULL,
  product_campaign       text NOT NULL DEFAULT '',
  agent_id               uuid NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
  instance_id            uuid NOT NULL REFERENCES evolution_instances(id) ON DELETE RESTRICT,
  status                 text NOT NULL DEFAULT 'inactive'
                           CHECK (status IN ('active', 'inactive')),
  entry_silence_minutes  integer NOT NULL DEFAULT 15
                           CHECK (entry_silence_minutes > 0),
  cancel_on_reply        boolean NOT NULL DEFAULT true,
  cancel_on_resolved     boolean NOT NULL DEFAULT true,
  cancel_on_opt_out      boolean NOT NULL DEFAULT true,
  last_executed_at       timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

-- ─── remarketing_steps ────────────────────────────────────────────────────────
CREATE TABLE remarketing_steps (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  flow_id          uuid NOT NULL REFERENCES remarketing_flows(id) ON DELETE CASCADE,
  step_order       integer NOT NULL CHECK (step_order > 0),
  wait_minutes     integer NOT NULL DEFAULT 60 CHECK (wait_minutes >= 0),
  message_type     text NOT NULL DEFAULT 'text'
                     CHECK (message_type IN ('text', 'audio', 'image')),
  message_content  text NOT NULL DEFAULT '',
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (flow_id, step_order)
);

-- ─── remarketing_enrollments ──────────────────────────────────────────────────
CREATE TABLE remarketing_enrollments (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  flow_id           uuid NOT NULL REFERENCES remarketing_flows(id) ON DELETE CASCADE,
  conversation_id   uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  organization_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  next_step_id      uuid REFERENCES remarketing_steps(id) ON DELETE SET NULL,
  enrolled_at       timestamptz NOT NULL DEFAULT now(),
  last_step_sent_at timestamptz,
  status            text NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active', 'completed', 'cancelled')),
  cancel_reason     text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- ─── Constraints ──────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX idx_remarketing_enrollments_unique_active
  ON remarketing_enrollments (conversation_id)
  WHERE status = 'active';

-- ─── Indexes para queries do worker ───────────────────────────────────────────
CREATE INDEX idx_remarketing_flows_org_status
  ON remarketing_flows (organization_id, status);

CREATE INDEX idx_remarketing_enrollments_active
  ON remarketing_enrollments (status, next_step_id)
  WHERE status = 'active';

CREATE INDEX idx_messages_conversation_role_created
  ON messages (conversation_id, role, created_at);

-- ─── Trigger updated_at ───────────────────────────────────────────────────────
CREATE TRIGGER trg_remarketing_flows_updated_at
  BEFORE UPDATE ON remarketing_flows
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_remarketing_enrollments_updated_at
  BEFORE UPDATE ON remarketing_enrollments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE remarketing_flows ENABLE ROW LEVEL SECURITY;
ALTER TABLE remarketing_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE remarketing_enrollments ENABLE ROW LEVEL SECURITY;
