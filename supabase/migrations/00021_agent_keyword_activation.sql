-- Lista de regexes de ativação no agente (vazia = sempre ativo)
ALTER TABLE agents ADD COLUMN IF NOT EXISTS activation_keywords text[] NOT NULL DEFAULT '{}';

-- Estado de ativação por conversa
-- DEFAULT false: todas as conversas começam não-ativadas
-- O UPDATE abaixo imediatamente ativa conversas de agentes sem keywords
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS is_keyword_activated boolean NOT NULL DEFAULT false;

-- Backfill: ativar conversas de agentes que não têm keywords configuradas
-- (agentes com keywords ficam false até o contato enviar a keyword)
UPDATE conversations
SET is_keyword_activated = true
WHERE agent_id IN (
  SELECT id FROM agents WHERE activation_keywords = '{}'
);
