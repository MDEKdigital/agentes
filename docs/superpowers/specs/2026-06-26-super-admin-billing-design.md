# Super-Admin Billing Panel — Design Spec

**Date:** 2026-06-26  
**Status:** Approved  
**Scope:** Painel de gerenciamento de assinaturas de todos os clientes, acessível apenas pelo super-admin dentro da área de billing existente.

---

## Problema

O dono da plataforma não tem visibilidade centralizada das assinaturas de todos os clientes, nem como realizar ações administrativas (ativar, mudar plano, cancelar, reenviar convite) sem acesso direto ao banco.

---

## Solução

Quando o usuário logado é o super-admin (email igual a `SUPER_ADMIN_EMAIL` no servidor), a página `/settings/billing` exibe uma aba extra "Admin" com visão global de todas as organizações e suas assinaturas.

---

## Autenticação do Super-Admin

- Controlada exclusivamente por variável de ambiente `SUPER_ADMIN_EMAIL` no servidor da API.
- O email nunca é exposto ao cliente.
- O frontend descobre se é super-admin tentando carregar `GET /admin/organizations`: 200 = sim, 403 = não.
- Novo middleware `superAdminMiddleware` em `apps/api/src/middleware/super-admin.ts` protege todas as rotas `/admin/*`.

---

## API — Novas Rotas

Arquivo: `apps/api/src/routes/admin/index.ts`  
Todas as rotas usam `authMiddleware` + `superAdminMiddleware`.

| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/admin/organizations` | Lista todas as orgs com subscription completa, plano, email do owner, e últimos 20 billing_events |
| `POST` | `/admin/organizations/:orgId/subscriptions` | Cria assinatura manual (gateway: null, billing_interval: "manual" \| "monthly" \| "yearly" \| "lifetime") |
| `PATCH` | `/admin/subscriptions/:subId` | Atualiza campos da subscription (plan_id, status, current_period_end, billing_interval) e sincroniza organizations.plan_id |
| `DELETE` | `/admin/subscriptions/:subId` | Cancela assinatura (status = "cancelled", cancelled_at = now()) |
| `POST` | `/admin/organizations/:orgId/resend-invitation` | Renova expiração da convite pendente e reenvia email ao owner |

### Payload de criação (`POST /admin/organizations/:orgId/subscriptions`)
```json
{
  "plan_id": "uuid",
  "billing_interval": "manual" | "monthly" | "yearly" | "lifetime"
}
```

### Payload de atualização (`PATCH /admin/subscriptions/:subId`)
```json
{
  "plan_id": "uuid",           // opcional
  "status": "active" | "cancelled" | "past_due" | "paused" | "trial",  // opcional
  "current_period_end": "ISO8601",  // opcional
  "billing_interval": "manual" | "monthly" | "yearly" | "lifetime"     // opcional
}
```

---

## Database — Novo Arquivo de Queries

Arquivo: `packages/database/src/queries/admin.ts`  
Usa `getAdminClient()`. Nenhuma tabela nova.

### `getAllOrganizationsWithSubscriptions()`
Retorna todas as organizações com:
- Dados da org (id, name, slug, onboarding_status, created_at)
- Email e nome do owner (via `members` JOIN `auth.users` WHERE role = 'owner')
- Subscription completa (status, gateway, gateway_subscription_id, billing_interval, current_period_start, current_period_end, trial_end, cancelled_at, cancel_at_period_end, metadata)
- Plano (name, slug, price_monthly, price_yearly, max_agents, max_members, max_instances)
- Últimos 20 billing_events (event_type, status, gateway, created_at, error_message)

Ordenação: orgs por `created_at DESC`.

### `createManualSubscription(orgId, planId, interval)`
- Verifica se já existe subscription ativa para a org; se sim, retorna erro 409 (o admin deve usar PATCH)
- Chama `createSubscription()` existente com `gateway: null`
- Atualiza `organizations SET plan_id = planId WHERE id = orgId`

### `updateSubscriptionAdmin(subId, fields)`
- UPDATE `subscriptions` com os campos fornecidos
- Se `plan_id` incluído: também atualiza `organizations.plan_id`

### `cancelSubscriptionAdmin(subId)`
- UPDATE `subscriptions SET status = 'cancelled', cancelled_at = now() WHERE id = subId`
- Retorna a subscription atualizada

### `resendOwnerInvitation(orgId)`
- Busca invitation pendente da org (role = 'owner', accepted_at IS NULL)
- Chama `renewInvitationExpiry()` existente para estender +7 dias
- Envia email via `email-service` com o link de convite atualizado

---

## Frontend

### Modificação: `apps/web/src/app/(dashboard)/settings/billing/page.tsx`
- No mount, chama `GET /admin/organizations` via `apiFetch`
- Se resposta OK: armazena dados em estado `adminData` e renderiza aba "Admin" no tab switcher
- Se 403: ignora silenciosamente — nenhuma mudança visível para usuários normais

### Novo: `apps/web/src/app/(dashboard)/settings/billing/admin-panel.tsx`

**Tabela principal de organizações:**
Colunas: Nome da org · Email do owner · Plano · Status · Gateway · Fim do período · Ações

**Linha expandível por org:**
- Dados completos da subscription (gateway_subscription_id, billing_interval, metadata em JSON colapsável)
- Tabela de billing_events: tipo · status · gateway · data · erro (se houver)

**Ações por organização:**
- **Ativar manualmente** → Modal: select de plano (lista de planos ativos) + select de intervalo → `POST /admin/organizations/:orgId/subscriptions`
- **Mudar plano** → Modal: select de plano → `PATCH /admin/subscriptions/:subId` com `{ plan_id }`
- **Cancelar** → Confirmação inline → `DELETE /admin/subscriptions/:subId`
- **Reenviar convite** → Direto sem modal → `POST /admin/organizations/:orgId/resend-invitation`

Todos os componentes UI seguem o padrão existente do projeto (Tailwind + shadcn/ui). Nenhuma nova biblioteca.

---

## Segurança

- Nenhuma rota `/admin/*` é acessível sem `SUPER_ADMIN_EMAIL` configurado no servidor.
- O middleware verifica `request.user.email === process.env.SUPER_ADMIN_EMAIL` após autenticação JWT normal.
- RLS existente nas tabelas de billing não é contornada — as queries usam `getAdminClient()` (service role), que já é o padrão para todas as operações de billing no worker e na API.
- O email do super-admin nunca aparece em resposta de API nem em variável de ambiente do cliente.

---

## Arquivos Afetados

**Novos:**
- `apps/api/src/middleware/super-admin.ts`
- `apps/api/src/routes/admin/index.ts`
- `packages/database/src/queries/admin.ts`
- `apps/web/src/app/(dashboard)/settings/billing/admin-panel.tsx`

**Modificados:**
- `apps/api/src/index.ts` (ou onde as rotas são registradas) — registrar `/admin/*`
- `apps/web/src/app/(dashboard)/settings/billing/page.tsx` — adicionar tab Admin

---

## O que está fora do escopo

- Gerenciamento de planos (criar/editar planos via UI) — nenhum plano novo, apenas usar os existentes
- Portais de pagamento dos gateways (Stripe dashboard, etc.)
- Métricas/analytics de receita
- Autenticação 2FA adicional para o super-admin
