-- Adds UPDATE policy to organization_members.
-- Without this policy (RLS enabled + no UPDATE policy = default deny),
-- Postgres silently discards role changes from admins.
-- WITH CHECK restricts the new role value to 'admin' or 'agent' only,
-- preventing privilege escalation (admins cannot self-promote to 'owner').
CREATE POLICY "org_members_update" ON organization_members
  FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
    AND NEW.role IN ('admin', 'agent')
  );
