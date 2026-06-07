-- Fix: migration 00015 allowed any user to insert themselves as 'owner' of ANY org
-- (first branch had no organization_id constraint — privilege escalation).
-- New rule: user can only insert themselves as owner into a brand-new org
-- (one with zero existing members), preventing takeover of existing orgs.
DROP POLICY IF EXISTS "org_members_insert" ON organization_members;

CREATE POLICY "org_members_insert" ON organization_members
  FOR INSERT WITH CHECK (
    -- Onboarding: insert self as owner only into an org with no existing members
    (
      user_id = auth.uid()
      AND role = 'owner'
      AND NOT EXISTS (
        SELECT 1 FROM organization_members existing
        WHERE existing.organization_id = organization_id
      )
    )
    OR
    -- Normal flow: existing owner/admin adds members to their org
    (
      organization_id IN (
        SELECT organization_id FROM organization_members
        WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
      )
    )
  );
