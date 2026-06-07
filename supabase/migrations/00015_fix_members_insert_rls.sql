-- Fix: org_members_insert policy blocks onboarding.
-- The original policy required the user to ALREADY be a member to insert members,
-- making it impossible to add yourself as the first owner of a new org.
--
-- New policy allows:
--   1. User inserts themselves as 'owner' (onboarding: creating first org)
--   2. Existing owner/admin adds other members to their org
DROP POLICY IF EXISTS "org_members_insert" ON organization_members;

CREATE POLICY "org_members_insert" ON organization_members
  FOR INSERT WITH CHECK (
    -- Onboarding: user can insert themselves as owner of any org
    (user_id = auth.uid() AND role = 'owner')
    OR
    -- Normal flow: existing owner/admin can add members to their org
    (organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    ))
  );
