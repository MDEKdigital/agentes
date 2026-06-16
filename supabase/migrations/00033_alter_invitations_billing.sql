-- ─── Ajustes em organization_invitations para onboarding automático ───────────

-- 1. Permitir role 'owner' em convites criados pelo billing worker
ALTER TABLE organization_invitations
  DROP CONSTRAINT organization_invitations_role_check;

ALTER TABLE organization_invitations
  ADD CONSTRAINT organization_invitations_role_check
    CHECK (role IN ('owner', 'admin', 'agent'));

-- 2. invited_by nullable: convites do sistema não têm usuário humano remetente
ALTER TABLE organization_invitations
  ALTER COLUMN invited_by DROP NOT NULL;

-- 3. Auditoria de aceite
ALTER TABLE organization_invitations
  ADD COLUMN IF NOT EXISTS accepted_at         timestamptz,
  ADD COLUMN IF NOT EXISTS accepted_by_user_id uuid REFERENCES auth.users(id);
