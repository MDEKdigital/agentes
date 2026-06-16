-- ─── plan_gateway_mappings ────────────────────────────────────────────────────
-- Mapeia IDs de produto/plano de cada gateway para o plan_id interno.
-- Gerenciado apenas via service role — sem acesso de usuário final.
CREATE TABLE plan_gateway_mappings (
  id                 uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  plan_id            uuid NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  gateway            text NOT NULL
                       CHECK (gateway IN ('stripe', 'mercadopago', 'hotmart', 'kiwify', 'eduzz')),
  gateway_product_id text NOT NULL,
  billing_interval   text NOT NULL DEFAULT 'monthly'
                       CHECK (billing_interval IN ('monthly', 'yearly', 'lifetime', 'manual')),
  is_active          boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (gateway, gateway_product_id)
);

CREATE TRIGGER trg_plan_gateway_mappings_updated_at
  BEFORE UPDATE ON plan_gateway_mappings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX idx_pgm_plan    ON plan_gateway_mappings (plan_id);
CREATE INDEX idx_pgm_gateway ON plan_gateway_mappings (gateway, gateway_product_id);

-- ─── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE plan_gateway_mappings ENABLE ROW LEVEL SECURITY;

-- Nenhum usuário autenticado pode ler mapeamentos via client-side.
-- Acesso exclusivo via service role (billing worker).
CREATE POLICY "plan_gateway_mappings_select" ON plan_gateway_mappings
  FOR SELECT USING (false);
