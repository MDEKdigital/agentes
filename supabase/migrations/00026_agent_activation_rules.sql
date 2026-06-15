-- 1. Adicionar activation_rules na tabela agents
ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS activation_rules jsonb NOT NULL DEFAULT '[]';

-- 2. Migrar dados existentes: cada keyword regex vira uma regra single_word
UPDATE agents
SET activation_rules = (
  SELECT jsonb_agg(
    jsonb_build_object('type', 'single_word', 'value', kw)
  )
  FROM unnest(activation_keywords) AS kw
)
WHERE array_length(activation_keywords, 1) > 0;

-- 3. Remover coluna antiga
ALTER TABLE agents DROP COLUMN IF EXISTS activation_keywords;

-- 4. Adicionar flag de confirmação pendente em conversations
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS awaiting_activation_confirmation boolean NOT NULL DEFAULT false;
