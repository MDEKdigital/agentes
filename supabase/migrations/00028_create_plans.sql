-- ─── plans ────────────────────────────────────────────────────────────────────
CREATE TABLE plans (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          text NOT NULL,
  slug          text NOT NULL UNIQUE,
  price_monthly numeric(10,2) NOT NULL DEFAULT 0,
  price_yearly  numeric(10,2) NOT NULL DEFAULT 0,
  currency      text NOT NULL DEFAULT 'BRL',
  max_agents    integer NOT NULL DEFAULT 1,
  max_instances integer NOT NULL DEFAULT 1,
  max_members   integer NOT NULL DEFAULT 3,
  features      jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active     boolean NOT NULL DEFAULT true,
  sort_order    integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_plans_updated_at
  BEFORE UPDATE ON plans
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX idx_plans_slug   ON plans (slug);
CREATE INDEX idx_plans_active ON plans (is_active);

-- ─── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE plans ENABLE ROW LEVEL SECURITY;

-- Qualquer pessoa autenticada pode listar planos (página de pricing)
CREATE POLICY "plans_select_public" ON plans
  FOR SELECT USING (true);

-- ─── Seed inicial ─────────────────────────────────────────────────────────────
INSERT INTO plans (name, slug, price_monthly, price_yearly, max_agents, max_instances, max_members, features, sort_order)
VALUES
  ('Free',       'free',       0,       0,       1,  1,  3,
   '["inbox","basic_agents"]'::jsonb,                                              1),
  ('Pro',        'pro',        197.00,  1970.00, 5,  3,  10,
   '["inbox","basic_agents","remarketing","knowledge_base"]'::jsonb,              2),
  ('Enterprise', 'enterprise', 497.00,  4970.00, 20, 10, 50,
   '["inbox","basic_agents","remarketing","knowledge_base","priority_support"]'::jsonb, 3)
ON CONFLICT (slug) DO NOTHING;
