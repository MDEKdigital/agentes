#!/usr/bin/env bash
# test-flows.sh — End-to-end authenticated flow tests
# Run from repo root. Requires dev server on :3000 and API on :3001.
#
# Architecture:
#   Org/agent CRUD  → Supabase REST / RPC (direct)
#   Instances/secrets/conversations → Fastify API (port 3001)
set -euo pipefail

SUPABASE_URL="https://wsfmgkzgkpdahcvrkdwg.supabase.co"
SUPABASE_REST="$SUPABASE_URL/rest/v1"
ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndzZm1na3pna3BkYWhjdnJrZHdnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA2ODEzNzYsImV4cCI6MjA5NjI1NzM3Nn0.kJ32lCwqHErJUdt0LtSSvTm3kNJBSLXvkhTrxgTtWvw"
SERVICE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndzZm1na3pna3BkYWhjdnJrZHdnIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDY4MTM3NiwiZXhwIjoyMDk2MjU3Mzc2fQ.AtPtN42EHbZphi-re9_DUV8wAszhqdrXm1oPzPFhnhw"
API_URL="http://localhost:3001"
WEB_URL="http://localhost:3000"
TS=$(date +%s)
TEST_EMAIL="testci_${TS}@test.com"
TEST_PASS="TestPass123!"

PASS=0; FAIL=0
USER_ID=""; ACCESS_TOKEN=""; REFRESH_TOKEN=""; ORG_ID=""; AGENT_ID=""

check() {
  local label="$1" expected="$2" actual="$3"
  if [[ "$actual" == *"$expected"* ]]; then
    echo "  ✓ $label"
    ((PASS++)) || true
  else
    echo "  ✗ $label"
    echo "    esperado: ...${expected}..."
    echo "    recebido: ${actual:0:200}"
    ((FAIL++)) || true
  fi
}

check_code() {
  local label="$1" expected="$2" actual="$3"
  if [[ "$actual" == "$expected" ]]; then
    echo "  ✓ $label → HTTP $actual"
    ((PASS++)) || true
  else
    echo "  ✗ $label  (esperado HTTP $expected, recebido $actual)"
    ((FAIL++)) || true
  fi
}

cleanup() {
  echo ""
  echo "── Limpeza ──────────────────────────────"
  if [[ -n "$AGENT_ID" ]]; then
    curl -s -X DELETE "$SUPABASE_REST/agents?id=eq.$AGENT_ID" \
      -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" > /dev/null
    echo "  ✓ Agente removido"
  fi
  if [[ -n "$ORG_ID" ]]; then
    # Fastify DELETE org (admin client inside) – may fail if already deleted
    curl -s -X DELETE "$API_URL/organizations/$ORG_ID" \
      -H "Authorization: Bearer $ACCESS_TOKEN" > /dev/null 2>&1 || true
    # Fallback: direct service-role delete
    curl -s -X DELETE "$SUPABASE_REST/organizations?id=eq.$ORG_ID" \
      -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" > /dev/null
    echo "  ✓ Organização removida"
  fi
  if [[ -n "$USER_ID" ]]; then
    curl -s -X DELETE "$SUPABASE_URL/auth/v1/admin/users/$USER_ID" \
      -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" > /dev/null
    echo "  ✓ Usuário removido"
  fi
}
trap cleanup EXIT

# ── 1. CRIAR USUÁRIO DE TESTE ───────────────────────────────────────────────
echo ""
echo "══════════════════════════════════════════"
echo "  1. CRIAR USUÁRIO DE TESTE"
echo "══════════════════════════════════════════"

CREATE=$(curl -s -X POST "$SUPABASE_URL/auth/v1/admin/users" \
  -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASS\",\"email_confirm\":true}")

USER_ID=$(echo "$CREATE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
check "Criar usuário" '"id"' "$CREATE"
echo "  User ID: $USER_ID"

# ── 2. AUTENTICAÇÃO ─────────────────────────────────────────────────────────
echo ""
echo "══════════════════════════════════════════"
echo "  2. AUTENTICAÇÃO"
echo "══════════════════════════════════════════"

SIGNIN=$(curl -s -X POST "$SUPABASE_URL/auth/v1/token?grant_type=password" \
  -H "apikey: $ANON_KEY" -H "Content-Type: application/json" \
  -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASS\"}")

ACCESS_TOKEN=$(echo "$SIGNIN" | grep -o '"access_token":"[^"]*"' | cut -d'"' -f4)
REFRESH_TOKEN=$(echo "$SIGNIN" | grep -o '"refresh_token":"[^"]*"' | cut -d'"' -f4)
check "Sign in com email/senha" '"access_token"' "$SIGNIN"
echo "  JWT (prefixo): ${ACCESS_TOKEN:0:40}..."

# ── 3. ONBOARDING — CRIAR ORGANIZAÇÃO VIA RPC ───────────────────────────────
echo ""
echo "══════════════════════════════════════════"
echo "  3. ONBOARDING — CRIAR ORGANIZAÇÃO"
echo "══════════════════════════════════════════"

ORG_SLUG="org-ci-$TS"
ORG_RPC=$(curl -s -X POST "$SUPABASE_REST/rpc/create_organization" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"p_name\":\"Org CI Teste\",\"p_slug\":\"$ORG_SLUG\"}")

ORG_ID=$(echo "$ORG_RPC" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
check "RPC create_organization — retorna org" '"id"' "$ORG_RPC"
echo "  Org ID: $ORG_ID"

# Verificar membership owner foi criado
MEMBER_CHECK=$(curl -s "$SUPABASE_REST/organization_members?organization_id=eq.$ORG_ID&select=role" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ACCESS_TOKEN")
check "Membership owner criado automaticamente" '"owner"' "$MEMBER_CHECK"

# ── 4. CRIAR E GERENCIAR AGENTE ─────────────────────────────────────────────
echo ""
echo "══════════════════════════════════════════"
echo "  4. AGENTES"
echo "══════════════════════════════════════════"

AGENT_RESP=$(curl -s -X POST "$SUPABASE_REST/agents" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d "{\"name\":\"Agente CI\",\"system_prompt\":\"Teste.\",\"model\":\"gpt-4o-mini\",\"provider\":\"openai\",\"organization_id\":\"$ORG_ID\"}")

AGENT_ID=$(echo "$AGENT_RESP" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
check "INSERT agent via Supabase REST" '"id"' "$AGENT_RESP"
echo "  Agent ID: $AGENT_ID"

AGENTS_LIST=$(curl -s "$SUPABASE_REST/agents?organization_id=eq.$ORG_ID" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ACCESS_TOKEN")
check "SELECT agents — lista o agente criado" '"Agente CI"' "$AGENTS_LIST"

UPD_RESP=$(curl -s -X PATCH "$SUPABASE_REST/agents?id=eq.$AGENT_ID" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" -H "Prefer: return=representation" \
  -d '{"name":"Agente CI Atualizado"}')
check "PATCH agent name" '"Agente CI Atualizado"' "$UPD_RESP"

# ── 5. FASTIFY API — SEGURANÇA ──────────────────────────────────────────────
echo ""
echo "══════════════════════════════════════════"
echo "  5. FASTIFY API — SEGURANÇA"
echo "══════════════════════════════════════════"

H=$(curl -s "$API_URL/health")
check "GET /health → ok" '"ok"' "$H"

NO_AUTH=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/organizations/$ORG_ID/instances")
check_code "GET /instances sem token → 401" "401" "$NO_AUTH"

FAKE_ORG="00000000-0000-0000-0000-000000000000"
DENY=$(curl -s -o /dev/null -w "%{http_code}" \
  "$API_URL/organizations/$FAKE_ORG/instances" \
  -H "Authorization: Bearer $ACCESS_TOKEN")
check_code "GET /instances de org inexistente → 403" "403" "$DENY"

# ── 6. FASTIFY API — INSTÂNCIAS ─────────────────────────────────────────────
echo ""
echo "══════════════════════════════════════════"
echo "  6. FASTIFY API — INSTÂNCIAS"
echo "══════════════════════════════════════════"

INST=$(curl -s "$API_URL/organizations/$ORG_ID/instances" \
  -H "Authorization: Bearer $ACCESS_TOKEN")
check "GET /instances → array vazio" "[]" "$INST"

# ── 7. FASTIFY API — SECRETS ────────────────────────────────────────────────
echo ""
echo "══════════════════════════════════════════"
echo "  7. FASTIFY API — SECRETS (API KEYS)"
echo "══════════════════════════════════════════"

SEC=$(curl -s "$API_URL/organizations/$ORG_ID/secrets" \
  -H "Authorization: Bearer $ACCESS_TOKEN")
check "GET /secrets → array vazio" "[]" "$SEC"

PUT_SEC=$(curl -s -o /dev/null -w "%{http_code}" \
  -X PUT "$API_URL/organizations/$ORG_ID/secrets/openai" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"key":"sk-test-key-placeholder"}')
check_code "PUT /secrets/openai → 204" "204" "$PUT_SEC"

SEC_AFTER=$(curl -s "$API_URL/organizations/$ORG_ID/secrets" \
  -H "Authorization: Bearer $ACCESS_TOKEN")
check "GET /secrets após PUT → openai has_key=true" '"has_key":true' "$SEC_AFTER"

DEL_SEC=$(curl -s -o /dev/null -w "%{http_code}" \
  -X DELETE "$API_URL/organizations/$ORG_ID/secrets/openai" \
  -H "Authorization: Bearer $ACCESS_TOKEN")
check_code "DELETE /secrets/openai → 204" "204" "$DEL_SEC"

BAD_PROV=$(curl -s -o /dev/null -w "%{http_code}" \
  -X PUT "$API_URL/organizations/$ORG_ID/secrets/invalidprovider" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"key":"sk-test"}')
check_code "PUT /secrets/invalidprovider → 400 (provider inválido)" "400" "$BAD_PROV"

# ── 8. FASTIFY API — DELETE ORG ─────────────────────────────────────────────
echo ""
echo "══════════════════════════════════════════"
echo "  8. FASTIFY API — DELETAR ORGANIZAÇÃO"
echo "══════════════════════════════════════════"

# Remove agent first (org delete is cascade in DB but we test agent delete route)
DEL_AGENT=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE \
  "$SUPABASE_REST/agents?id=eq.$AGENT_ID" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ACCESS_TOKEN")
check_code "DELETE agent via Supabase REST → 200/204" "204" "$DEL_AGENT"
AGENT_ID=""  # prevent double cleanup

DEL_ORG=$(curl -s -o /dev/null -w "%{http_code}" \
  -X DELETE "$API_URL/organizations/$ORG_ID" \
  -H "Authorization: Bearer $ACCESS_TOKEN")
check_code "DELETE /organizations/:id (owner) → 204" "204" "$DEL_ORG"
ORG_ID=""  # already deleted

# ── 9. NEXT.JS — PÁGINAS AUTENTICADAS ───────────────────────────────────────
echo ""
echo "══════════════════════════════════════════"
echo "  9. NEXT.JS — PÁGINAS"
echo "══════════════════════════════════════════"

# Sem auth → redirect para /login
ROOT_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$WEB_URL/" --max-redirs 0)
check_code "GET / sem auth → 307" "307" "$ROOT_CODE"

LOGIN_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$WEB_URL/login")
check_code "GET /login → 200" "200" "$LOGIN_CODE"

REG_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$WEB_URL/register")
check_code "GET /register → 200" "200" "$REG_CODE"

# Dashboard: cookie SSR válido → não retorna 401 ou 5xx
# (org já foi deletada → redireciona para /onboarding = 307, mas servidor responde)
for ROUTE in inbox agents settings instances team onboarding; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" "$WEB_URL/$ROUTE" \
    -H "Cookie: sb-wsfmgkzgkpdahcvrkdwg-auth-token=%5B%22${ACCESS_TOKEN}%22%2C%22${REFRESH_TOKEN}%22%5D" \
    --max-redirs 0)
  if [[ "$CODE" == "200" || "$CODE" == "307" ]]; then
    echo "  ✓ GET /$ROUTE com sessão → HTTP $CODE"
    ((PASS++)) || true
  else
    echo "  ✗ GET /$ROUTE com sessão → HTTP $CODE (esperado 200 ou 307)"
    ((FAIL++)) || true
  fi
done

# ── RESULTADO ────────────────────────────────────────────────────────────────
echo ""
echo "══════════════════════════════════════════"
echo "  RESULTADO FINAL"
echo "══════════════════════════════════════════"
echo "  ✓ PASSOU: $PASS"
echo "  ✗ FALHOU: $FAIL"
echo ""
if [[ $FAIL -eq 0 ]]; then
  echo "  ✅ TODOS OS TESTES PASSARAM"
  exit 0
else
  echo "  ❌ $FAIL TESTE(S) FALHARAM"
  exit 1
fi
