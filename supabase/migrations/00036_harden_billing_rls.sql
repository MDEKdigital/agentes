-- Hardening RLS: bloqueio explícito de writes em tabelas de billing.
--
-- Contexto:
--   subscriptions e billing_events são modificadas EXCLUSIVAMENTE pelo
--   service_role (webhook handlers de gateways de pagamento).
--   O service_role tem BYPASSRLS e ignora todas as políticas RLS.
--
-- Sem estas políticas, o bloqueio de writes para usuários autenticados
-- dependia do "default deny" implícito do PostgreSQL (RLS habilitado +
-- nenhuma política = negado). Esse comportamento é correto mas opaco:
--   - Difícil de auditar
--   - Um DROP POLICY acidental poderia expor a operação
--   - Futuros desenvolvedores podem não saber que o bloqueio é intencional
--
-- Com estas políticas o bloqueio é explícito, rastreável e testado.
-- USING (false) / WITH CHECK (false) → nega ativamente para authenticated/anon.
-- service_role não é afetado (bypassa RLS).

-- ─── subscriptions ────────────────────────────────────────────────────────────

CREATE POLICY "subscriptions_no_insert" ON subscriptions
  FOR INSERT
  WITH CHECK (false);

CREATE POLICY "subscriptions_no_update" ON subscriptions
  FOR UPDATE
  USING (false);

CREATE POLICY "subscriptions_no_delete" ON subscriptions
  FOR DELETE
  USING (false);

-- ─── billing_events ───────────────────────────────────────────────────────────

CREATE POLICY "billing_events_no_insert" ON billing_events
  FOR INSERT
  WITH CHECK (false);

CREATE POLICY "billing_events_no_update" ON billing_events
  FOR UPDATE
  USING (false);

CREATE POLICY "billing_events_no_delete" ON billing_events
  FOR DELETE
  USING (false);
