-- Audit log table for tracking critical actions across the system.
-- Writes are exclusively via service_role (API + worker). Authenticated users
-- may read their own organization's logs.

CREATE TABLE audit_logs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
  user_id         uuid,
  action          text NOT NULL,
  entity_type     text NOT NULL,
  entity_id       text,
  metadata        jsonb NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Fast lookups by org (most common query) and by time
CREATE INDEX audit_logs_organization_id_created_at_idx
  ON audit_logs (organization_id, created_at DESC);

-- Fast lookup for a specific entity's history
CREATE INDEX audit_logs_entity_idx
  ON audit_logs (entity_type, entity_id);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- service_role bypasses RLS — handles all writes from API and worker.

-- Authenticated users may read logs for organizations they belong to.
CREATE POLICY "audit_logs_select_own_org"
  ON audit_logs
  FOR SELECT
  TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id
      FROM organization_members
      WHERE user_id = auth.uid()
    )
  );

-- Explicit block: authenticated users cannot write audit logs directly.
CREATE POLICY "audit_logs_no_insert"
  ON audit_logs FOR INSERT WITH CHECK (false);

CREATE POLICY "audit_logs_no_update"
  ON audit_logs FOR UPDATE USING (false);

CREATE POLICY "audit_logs_no_delete"
  ON audit_logs FOR DELETE USING (false);
