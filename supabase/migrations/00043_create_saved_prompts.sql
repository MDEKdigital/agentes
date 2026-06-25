CREATE TABLE saved_prompts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  niche text NOT NULL DEFAULT '',
  content text NOT NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_saved_prompts_org ON saved_prompts(organization_id);

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_saved_prompts_updated_at
  BEFORE UPDATE ON saved_prompts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE saved_prompts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members can manage saved_prompts"
  ON saved_prompts FOR ALL
  TO authenticated
  USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()))
  WITH CHECK (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()));

CREATE POLICY "service role full access to saved_prompts"
  ON saved_prompts FOR ALL TO service_role USING (true) WITH CHECK (true);
