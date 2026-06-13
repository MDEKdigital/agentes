-- Corrige semântica de is_keyword_activated: o campo agora significa
-- "ativado via keyword match", não "criado quando o agente não tinha keywords".
-- O guard no worker usa agent.activation_keywords.length === 0 para pular o gate,
-- portanto is_keyword_activated=false em conversas de agentes sem keywords é seguro.
--
-- Apenas reseta conversas cujo agente NÃO tem keywords configuradas
-- (exatamente o conjunto que foi backfillado pela migration 00021).
-- Conversas de agentes com keywords que já foram ativadas por match real
-- são preservadas.
UPDATE conversations c
SET is_keyword_activated = false
WHERE c.is_keyword_activated = true
  AND EXISTS (
    SELECT 1 FROM agents a
    WHERE a.id = c.agent_id
      AND a.activation_keywords = '{}'
  );
