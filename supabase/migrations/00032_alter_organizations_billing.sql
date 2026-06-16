-- ─── Adiciona campos de billing em organizations ───────────────────────────────
-- ADD COLUMN é online (sem table lock) no Postgres.
-- plan_id nullable: orgs existentes ficam sem FK até billing ser ativado.
-- onboarding_status default 'active': orgs existentes já têm owner confirmado.
-- Campo plan (legado) é mantido intacto — queries existentes não são alteradas.

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS plan_id            uuid REFERENCES plans(id),
  ADD COLUMN IF NOT EXISTS onboarding_status  text NOT NULL DEFAULT 'active'
    CHECK (onboarding_status IN ('pending_owner', 'active', 'suspended'));

-- Preencher plan_id nas orgs existentes a partir do campo plan legado
UPDATE organizations o
SET plan_id = p.id
FROM plans p
WHERE p.slug = o.plan
  AND o.plan_id IS NULL;

-- Índice para o worker de onboarding varrer orgs pendentes
CREATE INDEX IF NOT EXISTS idx_orgs_onboarding_status
  ON organizations (onboarding_status)
  WHERE onboarding_status != 'active';
