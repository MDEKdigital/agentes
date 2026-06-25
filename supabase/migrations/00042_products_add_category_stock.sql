ALTER TABLE products
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS stock_quantity integer;

CREATE INDEX IF NOT EXISTS idx_products_org_category ON products(organization_id, category);
