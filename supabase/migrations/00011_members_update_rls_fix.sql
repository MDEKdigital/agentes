-- Fix: the previous UPDATE policy (00010) blocked ALL updates to rows where
-- role='owner' because WITH CHECK evaluates NEW.role, which stays 'owner'
-- even when other columns are updated (e.g., the updated_at trigger fires).
-- This replaces the policy to allow pass-through updates on existing owner
-- rows while still preventing promotion TO 'owner'.
DROP POLICY IF EXISTS "org_members_update" ON organization_members;

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
    AND (
      NEW.role IN ('admin', 'agent')  -- non-owner rows: only admin/agent allowed
      OR OLD.role = 'owner'           -- owner rows: updates allowed (role stays 'owner')
    )
  );
