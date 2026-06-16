-- ─── DROP POLICY IF EXISTS (idempotency guard) ───────────────────────────────
DROP POLICY IF EXISTS "remarketing_flows_select"        ON remarketing_flows;
DROP POLICY IF EXISTS "remarketing_flows_insert"        ON remarketing_flows;
DROP POLICY IF EXISTS "remarketing_flows_update"        ON remarketing_flows;
DROP POLICY IF EXISTS "remarketing_flows_delete"        ON remarketing_flows;

DROP POLICY IF EXISTS "remarketing_enrollments_select"  ON remarketing_enrollments;
DROP POLICY IF EXISTS "remarketing_enrollments_insert"  ON remarketing_enrollments;
DROP POLICY IF EXISTS "remarketing_enrollments_update"  ON remarketing_enrollments;
DROP POLICY IF EXISTS "remarketing_enrollments_delete"  ON remarketing_enrollments;

DROP POLICY IF EXISTS "remarketing_steps_select"        ON remarketing_steps;
DROP POLICY IF EXISTS "remarketing_steps_insert"        ON remarketing_steps;
DROP POLICY IF EXISTS "remarketing_steps_update"        ON remarketing_steps;
DROP POLICY IF EXISTS "remarketing_steps_delete"        ON remarketing_steps;

-- ─── remarketing_flows ────────────────────────────────────────────────────────
CREATE POLICY "remarketing_flows_select" ON remarketing_flows
  FOR SELECT USING (organization_id IN (SELECT get_user_org_ids()));

CREATE POLICY "remarketing_flows_insert" ON remarketing_flows
  FOR INSERT WITH CHECK (organization_id IN (SELECT get_user_org_ids()));

CREATE POLICY "remarketing_flows_update" ON remarketing_flows
  FOR UPDATE USING (organization_id IN (SELECT get_user_org_ids()));

CREATE POLICY "remarketing_flows_delete" ON remarketing_flows
  FOR DELETE USING (organization_id IN (SELECT get_user_org_ids()));

-- ─── remarketing_enrollments ──────────────────────────────────────────────────
CREATE POLICY "remarketing_enrollments_select" ON remarketing_enrollments
  FOR SELECT USING (organization_id IN (SELECT get_user_org_ids()));

CREATE POLICY "remarketing_enrollments_insert" ON remarketing_enrollments
  FOR INSERT WITH CHECK (organization_id IN (SELECT get_user_org_ids()));

CREATE POLICY "remarketing_enrollments_update" ON remarketing_enrollments
  FOR UPDATE USING (organization_id IN (SELECT get_user_org_ids()));

CREATE POLICY "remarketing_enrollments_delete" ON remarketing_enrollments
  FOR DELETE USING (organization_id IN (SELECT get_user_org_ids()));

-- ─── remarketing_steps ───────────────────────────────────────────────────────
-- No organization_id column — access scoped via parent flow ownership
CREATE POLICY "remarketing_steps_select" ON remarketing_steps
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM remarketing_flows rf
      WHERE rf.id = remarketing_steps.flow_id
        AND rf.organization_id IN (SELECT get_user_org_ids())
    )
  );

CREATE POLICY "remarketing_steps_insert" ON remarketing_steps
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM remarketing_flows rf
      WHERE rf.id = remarketing_steps.flow_id
        AND rf.organization_id IN (SELECT get_user_org_ids())
    )
  );

CREATE POLICY "remarketing_steps_update" ON remarketing_steps
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM remarketing_flows rf
      WHERE rf.id = remarketing_steps.flow_id
        AND rf.organization_id IN (SELECT get_user_org_ids())
    )
  );

CREATE POLICY "remarketing_steps_delete" ON remarketing_steps
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM remarketing_flows rf
      WHERE rf.id = remarketing_steps.flow_id
        AND rf.organization_id IN (SELECT get_user_org_ids())
    )
  );
