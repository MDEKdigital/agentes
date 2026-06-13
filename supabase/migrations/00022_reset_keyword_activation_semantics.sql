-- Corrige semântica de is_keyword_activated: o campo agora significa
-- "ativado via keyword match", não "criado quando o agente não tinha keywords".
-- O guard no worker usa agent.activation_keywords.length === 0 para pular o gate,
-- portanto is_keyword_activated=false em conversas de agentes sem keywords é seguro.
-- Isso garante que keywords adicionadas ao agente depois retroativamente se apliquem
-- a conversas abertas existentes.
UPDATE conversations SET is_keyword_activated = false;
