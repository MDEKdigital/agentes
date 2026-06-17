-- Fix accept_invitation RPC:
-- 1. Return type void → text (returns the member's role so frontend can redirect conditionally)
-- 2. Mark invitation as accepted: accepted_at + accepted_by_user_id
-- 3. Activate org onboarding: pending_owner → active when owner accepts

-- DROP required: CREATE OR REPLACE cannot change return type (void → text)
DROP FUNCTION IF EXISTS accept_invitation(uuid);

CREATE FUNCTION accept_invitation(invitation_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  inv record;
BEGIN
  SELECT * INTO inv
  FROM organization_invitations
  WHERE id = invitation_id
    AND status = 'pending'
    AND expires_at > now();

  IF inv IS NULL THEN
    RAISE EXCEPTION 'Convite inválido ou expirado';
  END IF;

  -- Guard: owner slot is a one-time claim
  IF inv.role = 'owner' AND EXISTS (
    SELECT 1 FROM organization_members WHERE organization_id = inv.organization_id
  ) THEN
    RAISE EXCEPTION 'Organização já possui membros — convite de proprietário não pode ser aceito novamente';
  END IF;

  INSERT INTO organization_members (organization_id, user_id, role)
  VALUES (inv.organization_id, auth.uid(), inv.role)
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  UPDATE organization_invitations
  SET
    status             = 'accepted',
    accepted_at        = now(),
    accepted_by_user_id = auth.uid()
  WHERE id = invitation_id;

  -- Activate org when owner claims it
  IF inv.role = 'owner' THEN
    UPDATE organizations
    SET onboarding_status = 'active'
    WHERE id = inv.organization_id
      AND onboarding_status = 'pending_owner';
  END IF;

  RETURN inv.role;
END;
$$;
