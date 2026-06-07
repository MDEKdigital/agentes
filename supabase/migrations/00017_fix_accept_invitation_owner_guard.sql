-- Fix: accept_invitation runs as SECURITY DEFINER (superuser), bypassing the
-- org_members_insert RLS WITH CHECK policy from migration 00016.
-- Adding an explicit application-level guard inside the function and making
-- the insert idempotent with ON CONFLICT DO NOTHING.
CREATE OR REPLACE FUNCTION accept_invitation(invitation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  inv record;
BEGIN
  SELECT * INTO inv FROM organization_invitations
  WHERE id = invitation_id AND status = 'pending' AND expires_at > now();

  IF inv IS NULL THEN
    RAISE EXCEPTION 'Convite inválido ou expirado';
  END IF;

  -- Mirror the RLS guard from org_members_insert policy:
  -- a self-owner insert via invitation is only valid into an org with no members yet.
  -- This prevents privilege escalation when an invitation with role='owner' is created
  -- for an existing org (SECURITY DEFINER skips the WITH CHECK policy).
  IF inv.role = 'owner' AND EXISTS (
    SELECT 1 FROM organization_members WHERE organization_id = inv.organization_id
  ) THEN
    RAISE EXCEPTION 'Organização já possui membros; não é possível aceitar convite como owner';
  END IF;

  -- Idempotent insert: if user is already a member (retry, double-click), do nothing
  INSERT INTO organization_members (organization_id, user_id, role)
  VALUES (inv.organization_id, auth.uid(), inv.role)
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  UPDATE organization_invitations SET status = 'accepted' WHERE id = invitation_id;
END;
$$;
