-- Adiciona next_check_at para controlar quando cada flow será reavaliado.
-- NULL = nunca executado → sempre elegível na próxima verificação.
-- Após cada execução o worker define o próximo momento de verificação
-- com base no menor delay dos steps ativos, evitando ciclos desnecessários.

ALTER TABLE remarketing_flows
  ADD COLUMN IF NOT EXISTS next_check_at TIMESTAMPTZ DEFAULT NULL;

-- Índice parcial: cobre apenas flows ativos com next_check_at preenchido,
-- tornando a query do worker eficiente mesmo com milhares de flows.
CREATE INDEX IF NOT EXISTS idx_remarketing_flows_next_check
  ON remarketing_flows (next_check_at)
  WHERE status = 'active';
