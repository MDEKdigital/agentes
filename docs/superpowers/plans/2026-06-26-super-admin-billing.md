# Super-Admin Billing Panel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar uma aba "Admin" na página `/settings/billing` visível apenas para o usuário cujo email coincide com `SUPER_ADMIN_EMAIL`, com visão global de todas as organizações e ações administrativas sobre assinaturas.

**Architecture:** Backend — middleware de super-admin protege rotas `/admin/*`; queries SQL via `getAdminClient()` (service role). Frontend — `page.tsx` tenta `GET /admin/organizations` no mount; se 200, renderiza `<AdminPanel>` em aba extra; se 403, ignora.

**Tech Stack:** Fastify (API), Supabase JS client, Next.js App Router, Tailwind CSS, shadcn/ui (padrão existente), TypeScript estrito.

## Global Constraints

- Nenhuma tabela nova — usa schema existente (organizations, subscriptions, plans, billing_events, organization_invitations)
- `SUPER_ADMIN_EMAIL` vive apenas no servidor da API — nunca exposto ao cliente
- Todas as rotas `/admin/*` exigem `authMiddleware` + `superAdminMiddleware`
- DB operations usam `getAdminClient()` (service role) — mesmo padrão de todo billing
- Nenhuma nova biblioteca no frontend — Tailwind + shadcn/ui existentes

---

### Task 1: Middleware + Queries do banco (camada base)

**Files:**
- Create: `apps/api/src/middleware/super-admin.ts`
- Create: `packages/database/src/queries/admin.ts`
- Modify: `packages/database/src/queries/index.ts` (adicionar 1 linha de export)

**Interfaces produzidas:**
```typescript
// super-admin.ts
export async function superAdminMiddleware(request: FastifyRequest, reply: FastifyReply): Promise<void>

// admin.ts
export interface AdminOrgRow {
  id: string; name: string; slug: string; onboarding_status: string; created_at: string; plan_id: string | null;
  owner_email: string | null;
  subscription: {
    id: string; status: string; gateway: string | null; gateway_subscription_id: string | null;
    billing_interval: string; current_period_start: string | null; current_period_end: string | null;
    trial_end: string | null; cancelled_at: string | null; cancel_at_period_end: boolean;
    metadata: Record<string, unknown>;
    plan: { id: string; name: string; slug: string; price_monthly: number; price_yearly: number;
            max_agents: number; max_members: number; max_instances: number; } | null;
  } | null;
  billing_events: Array<{ id: string; event_type: string; status: string; gateway: string | null; created_at: string; error_message: string | null; }>;
}
export async function getAllOrganizationsWithSubscriptions(client: SupabaseClient): Promise<AdminOrgRow[]>
export async function createManualSubscription(client: SupabaseClient, orgId: string, planId: string, interval: BillingInterval): Promise<Subscription>
export async function updateSubscriptionAdmin(client: SupabaseClient, subId: string, fields: Partial<Pick<Subscription,"plan_id"|"status"|"current_period_end"|"billing_interval">>): Promise<Subscription>
export async function cancelSubscriptionAdmin(client: SupabaseClient, subId: string): Promise<Subscription>
export async function findOwnerInvitationByOrg(client: SupabaseClient, orgId: string): Promise<OrganizationInvitation | null>
```

- [ ] **Step 1: Criar o middleware de super-admin**

Criar `apps/api/src/middleware/super-admin.ts`:

```typescript
import type { FastifyRequest, FastifyReply } from "fastify";

export async function superAdminMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const superAdminEmail = process.env.SUPER_ADMIN_EMAIL;
  if (!superAdminEmail || request.user.email !== superAdminEmail) {
    return reply.status(403).send({ error: "Acesso restrito." });
  }
}
```

- [ ] **Step 2: Criar o arquivo de queries admin**

Criar `packages/database/src/queries/admin.ts`:

```typescript
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Subscription, BillingInterval, OrganizationInvitation } from "@aula-agente/shared";
import { getSubscriptionByOrg, createSubscription } from "./billing";

export interface AdminOrgRow {
  id: string;
  name: string;
  slug: string;
  onboarding_status: string;
  created_at: string;
  plan_id: string | null;
  owner_email: string | null;
  subscription: {
    id: string;
    status: string;
    gateway: string | null;
    gateway_subscription_id: string | null;
    billing_interval: string;
    current_period_start: string | null;
    current_period_end: string | null;
    trial_end: string | null;
    cancelled_at: string | null;
    cancel_at_period_end: boolean;
    metadata: Record<string, unknown>;
    plan: {
      id: string;
      name: string;
      slug: string;
      price_monthly: number;
      price_yearly: number;
      max_agents: number;
      max_members: number;
      max_instances: number;
    } | null;
  } | null;
  billing_events: Array<{
    id: string;
    event_type: string;
    status: string;
    gateway: string | null;
    created_at: string;
    error_message: string | null;
  }>;
}

export async function getAllOrganizationsWithSubscriptions(
  client: SupabaseClient
): Promise<AdminOrgRow[]> {
  const [orgsRes, subsRes, invRes, eventsRes] = await Promise.all([
    client
      .from("organizations")
      .select("id, name, slug, onboarding_status, created_at, plan_id")
      .order("created_at", { ascending: false }),
    client
      .from("subscriptions")
      .select(
        "id, organization_id, status, gateway, gateway_subscription_id, billing_interval, current_period_start, current_period_end, trial_end, cancelled_at, cancel_at_period_end, metadata, plans(id, name, slug, price_monthly, price_yearly, max_agents, max_members, max_instances)"
      ),
    client
      .from("organization_invitations")
      .select("organization_id, email")
      .eq("role", "owner")
      .order("created_at", { ascending: false }),
    client
      .from("billing_events")
      .select("id, organization_id, event_type, status, gateway, created_at, error_message")
      .order("created_at", { ascending: false })
      .limit(1000),
  ]);

  if (orgsRes.error) throw orgsRes.error;
  if (subsRes.error) throw subsRes.error;
  if (invRes.error) throw invRes.error;
  if (eventsRes.error) throw eventsRes.error;

  const subsByOrg = new Map(
    (subsRes.data ?? []).map((s: Record<string, unknown>) => [s.organization_id as string, s])
  );
  // First invitation per org (most recent) for owner email
  const emailByOrg = new Map<string, string>();
  for (const inv of (invRes.data ?? []) as Array<{ organization_id: string; email: string }>) {
    if (!emailByOrg.has(inv.organization_id)) {
      emailByOrg.set(inv.organization_id, inv.email);
    }
  }
  // Group billing events per org (max 20)
  const eventsByOrg = new Map<string, typeof eventsRes.data>();
  for (const ev of (eventsRes.data ?? []) as Array<{ organization_id: string | null } & Record<string, unknown>>) {
    if (!ev.organization_id) continue;
    const orgId = ev.organization_id as string;
    const list = eventsByOrg.get(orgId) ?? [];
    if (list.length < 20) {
      list.push(ev as never);
      eventsByOrg.set(orgId, list);
    }
  }

  return (orgsRes.data ?? []).map((org: Record<string, unknown>) => {
    const raw = subsByOrg.get(org.id as string) as Record<string, unknown> | undefined;
    return {
      id: org.id as string,
      name: org.name as string,
      slug: org.slug as string,
      onboarding_status: org.onboarding_status as string,
      created_at: org.created_at as string,
      plan_id: org.plan_id as string | null,
      owner_email: emailByOrg.get(org.id as string) ?? null,
      subscription: raw
        ? {
            id: raw.id as string,
            status: raw.status as string,
            gateway: raw.gateway as string | null,
            gateway_subscription_id: raw.gateway_subscription_id as string | null,
            billing_interval: raw.billing_interval as string,
            current_period_start: raw.current_period_start as string | null,
            current_period_end: raw.current_period_end as string | null,
            trial_end: raw.trial_end as string | null,
            cancelled_at: raw.cancelled_at as string | null,
            cancel_at_period_end: raw.cancel_at_period_end as boolean,
            metadata: (raw.metadata ?? {}) as Record<string, unknown>,
            plan: (raw.plans ?? null) as AdminOrgRow["subscription"]["plan"],
          }
        : null,
      billing_events: (eventsByOrg.get(org.id as string) ?? []) as AdminOrgRow["billing_events"],
    };
  });
}

export async function createManualSubscription(
  client: SupabaseClient,
  orgId: string,
  planId: string,
  interval: BillingInterval
): Promise<Subscription> {
  const existing = await getSubscriptionByOrg(client, orgId);
  if (existing) {
    const err = new Error("SUBSCRIPTION_EXISTS") as Error & { statusCode: number };
    err.statusCode = 409;
    throw err;
  }

  const sub = await createSubscription(client, {
    organization_id: orgId,
    plan_id: planId,
    status: "active",
    billing_interval: interval,
    gateway: null,
    gateway_subscription_id: null,
    gateway_customer_id: null,
    current_period_start: new Date().toISOString(),
    current_period_end: null,
    metadata: {},
  });

  await client.from("organizations").update({ plan_id: planId }).eq("id", orgId);
  return sub;
}

export async function updateSubscriptionAdmin(
  client: SupabaseClient,
  subId: string,
  fields: Partial<
    Pick<Subscription, "plan_id" | "status" | "current_period_end" | "billing_interval">
  >
): Promise<Subscription> {
  const { data, error } = await client
    .from("subscriptions")
    .update(fields)
    .eq("id", subId)
    .select()
    .single();
  if (error) throw error;
  const sub = data as Subscription;
  if (fields.plan_id) {
    await client.from("organizations").update({ plan_id: fields.plan_id }).eq("id", sub.organization_id);
  }
  return sub;
}

export async function cancelSubscriptionAdmin(
  client: SupabaseClient,
  subId: string
): Promise<Subscription> {
  const { data, error } = await client
    .from("subscriptions")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
    .eq("id", subId)
    .select()
    .single();
  if (error) throw error;
  return data as Subscription;
}

export async function findOwnerInvitationByOrg(
  client: SupabaseClient,
  orgId: string
): Promise<OrganizationInvitation | null> {
  const { data, error } = await client
    .from("organization_invitations")
    .select("*")
    .eq("organization_id", orgId)
    .eq("role", "owner")
    .eq("status", "pending")
    .is("accepted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data as OrganizationInvitation | null;
}
```

- [ ] **Step 3: Exportar queries admin no index**

Editar `packages/database/src/queries/index.ts` — adicionar no final:

```typescript
export * from "./admin";
```

- [ ] **Step 4: Verificar TypeScript**

```bash
cd C:/Users/PC/Desktop/agentes
pnpm -r exec tsc --noEmit 2>&1 | Select-String "error TS"
```
Esperado: nenhuma linha de erro.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/middleware/super-admin.ts packages/database/src/queries/admin.ts packages/database/src/queries/index.ts
git commit -m "feat(admin): middleware super-admin e queries de billing admin"
```

---

### Task 2: Rotas API `/admin/*` + registro no servidor

**Files:**
- Create: `apps/api/src/routes/admin/index.ts`
- Modify: `apps/api/src/server.ts` (import + register)

**Interfaces consumidas (de Task 1):**
- `superAdminMiddleware` de `../../middleware/super-admin`
- `getAllOrganizationsWithSubscriptions`, `createManualSubscription`, `updateSubscriptionAdmin`, `cancelSubscriptionAdmin`, `findOwnerInvitationByOrg` de `@aula-agente/database`
- `findInvitationByEmailForResend`, `renewInvitationExpiry`, `getActivePlans` de `@aula-agente/database`
- `sendWelcomeEmailApi` de `../../lib/email`
- `fireAudit` de `../../lib/audit`

**Interfaces produzidas (para Task 3):**

```
GET  /admin/organizations         → { orgs: AdminOrgRow[], plans: Plan[] }
POST /admin/organizations/:orgId/subscriptions  body: { plan_id, billing_interval } → { subscription }
PATCH /admin/subscriptions/:subId body: { plan_id?, status?, current_period_end?, billing_interval? } → { subscription }
DELETE /admin/subscriptions/:subId → 204
POST /admin/organizations/:orgId/resend-invitation → { message: string }
```

- [ ] **Step 1: Criar `apps/api/src/routes/admin/index.ts`**

```typescript
import type { FastifyInstance } from "fastify";
import { getAdminClient } from "@aula-agente/database";
import {
  getAllOrganizationsWithSubscriptions,
  createManualSubscription,
  updateSubscriptionAdmin,
  cancelSubscriptionAdmin,
  findOwnerInvitationByOrg,
  getActivePlans,
  renewInvitationExpiry,
} from "@aula-agente/database";
import { authMiddleware } from "../../middleware/auth";
import { superAdminMiddleware } from "../../middleware/super-admin";
import { sendWelcomeEmailApi } from "../../lib/email";
import { fireAudit } from "../../lib/audit";
import type { BillingInterval, SubscriptionStatus } from "@aula-agente/shared";

const VALID_INTERVALS = new Set<BillingInterval>(["manual", "monthly", "yearly", "lifetime"]);
const VALID_STATUSES = new Set<SubscriptionStatus>(["active", "cancelled", "past_due", "paused", "trial"]);

export default async function adminRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authMiddleware);
  app.addHook("preHandler", superAdminMiddleware);

  // GET /admin/organizations
  app.get("/admin/organizations", async (request, reply) => {
    const db = getAdminClient();
    try {
      const [orgs, plans] = await Promise.all([
        getAllOrganizationsWithSubscriptions(db),
        getActivePlans(db),
      ]);
      return reply.send({ orgs, plans });
    } catch (err) {
      request.log.error({ err }, "admin: failed to load organizations");
      return reply.status(500).send({ error: "Erro ao carregar organizações." });
    }
  });

  // POST /admin/organizations/:orgId/subscriptions
  app.post<{ Params: { orgId: string } }>(
    "/admin/organizations/:orgId/subscriptions",
    async (request, reply) => {
      const { orgId } = request.params;
      const body = request.body as Record<string, unknown> | null | undefined;
      const planId = typeof body?.plan_id === "string" ? body.plan_id.trim() : "";
      const interval = typeof body?.billing_interval === "string" ? body.billing_interval : "";

      if (!planId) return reply.status(400).send({ error: "plan_id é obrigatório." });
      if (!VALID_INTERVALS.has(interval as BillingInterval)) {
        return reply.status(400).send({ error: "billing_interval inválido." });
      }

      const db = getAdminClient();
      try {
        const sub = await createManualSubscription(db, orgId, planId, interval as BillingInterval);
        fireAudit(db, {
          organization_id: orgId,
          user_id: request.user.id,
          action: "subscription.created_manual",
          entity_type: "subscription",
          entity_id: sub.id,
          metadata: { plan_id: planId, billing_interval: interval },
        }, request.log);
        return reply.status(201).send({ subscription: sub });
      } catch (err) {
        const e = err as Error & { statusCode?: number };
        if (e.message === "SUBSCRIPTION_EXISTS") {
          return reply.status(409).send({ error: "Organização já possui assinatura ativa. Use PATCH para atualizar." });
        }
        request.log.error({ err }, "admin: failed to create manual subscription");
        return reply.status(500).send({ error: "Erro ao criar assinatura." });
      }
    }
  );

  // PATCH /admin/subscriptions/:subId
  app.patch<{ Params: { subId: string } }>(
    "/admin/subscriptions/:subId",
    async (request, reply) => {
      const { subId } = request.params;
      const body = request.body as Record<string, unknown> | null | undefined;

      const fields: Record<string, unknown> = {};
      if (typeof body?.plan_id === "string") fields.plan_id = body.plan_id;
      if (typeof body?.status === "string") {
        if (!VALID_STATUSES.has(body.status as SubscriptionStatus)) {
          return reply.status(400).send({ error: "status inválido." });
        }
        fields.status = body.status;
      }
      if (typeof body?.current_period_end === "string") fields.current_period_end = body.current_period_end;
      if (typeof body?.billing_interval === "string") {
        if (!VALID_INTERVALS.has(body.billing_interval as BillingInterval)) {
          return reply.status(400).send({ error: "billing_interval inválido." });
        }
        fields.billing_interval = body.billing_interval;
      }
      if (Object.keys(fields).length === 0) {
        return reply.status(400).send({ error: "Nenhum campo válido para atualizar." });
      }

      const db = getAdminClient();
      try {
        const sub = await updateSubscriptionAdmin(db, subId, fields as Parameters<typeof updateSubscriptionAdmin>[2]);
        fireAudit(db, {
          organization_id: sub.organization_id,
          user_id: request.user.id,
          action: "subscription.updated_admin",
          entity_type: "subscription",
          entity_id: subId,
          metadata: fields,
        }, request.log);
        return reply.send({ subscription: sub });
      } catch (err) {
        request.log.error({ err }, "admin: failed to update subscription");
        return reply.status(500).send({ error: "Erro ao atualizar assinatura." });
      }
    }
  );

  // DELETE /admin/subscriptions/:subId
  app.delete<{ Params: { subId: string } }>(
    "/admin/subscriptions/:subId",
    async (request, reply) => {
      const { subId } = request.params;
      const db = getAdminClient();
      try {
        const sub = await cancelSubscriptionAdmin(db, subId);
        fireAudit(db, {
          organization_id: sub.organization_id,
          user_id: request.user.id,
          action: "subscription.cancelled_admin",
          entity_type: "subscription",
          entity_id: subId,
        }, request.log);
        return reply.status(204).send();
      } catch (err) {
        request.log.error({ err }, "admin: failed to cancel subscription");
        return reply.status(500).send({ error: "Erro ao cancelar assinatura." });
      }
    }
  );

  // POST /admin/organizations/:orgId/resend-invitation
  app.post<{ Params: { orgId: string } }>(
    "/admin/organizations/:orgId/resend-invitation",
    async (request, reply) => {
      const { orgId } = request.params;
      const db = getAdminClient();

      const invitation = await findOwnerInvitationByOrg(db, orgId).catch(() => null);
      if (!invitation) {
        return reply.status(404).send({ error: "Nenhum convite de owner pendente para esta organização." });
      }

      const newExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      await renewInvitationExpiry(db, invitation.id, newExpiresAt);

      try {
        await sendWelcomeEmailApi({
          to: invitation.email,
          name: invitation.email,
          invitationId: invitation.id,
        });
      } catch (err) {
        request.log.error({ err }, "admin: resend invitation email failed (non-fatal)");
      }

      fireAudit(db, {
        organization_id: orgId,
        user_id: request.user.id,
        action: "invitation.resent_admin",
        entity_type: "invitation",
        entity_id: invitation.id,
        metadata: { email: invitation.email },
      }, request.log);

      return reply.send({ message: "Convite reenviado para " + invitation.email });
    }
  );
}
```

- [ ] **Step 2: Registrar rotas no server.ts**

Editar `apps/api/src/server.ts`. Adicionar o import após os outros imports de rotas (ex.: após a linha de `promptStudioRoutes`):

```typescript
import adminRoutes from "./routes/admin/index";
```

Adicionar o registro após os outros `server.register(...)` (ex.: após `server.register(promptStudioRoutes)`):

```typescript
server.register(adminRoutes);
```

- [ ] **Step 3: TypeScript check**

```bash
pnpm -r exec tsc --noEmit 2>&1 | Select-String "error TS"
```
Esperado: nenhum erro.

- [ ] **Step 4: Teste manual das rotas**

Com a API rodando localmente, abrir o terminal e testar com um Bearer token válido de super-admin:

```bash
# Deve retornar 200 com { orgs: [...], plans: [...] }
curl -H "Authorization: Bearer TOKEN" http://localhost:3001/admin/organizations

# Com token de usuário normal deve retornar 403
curl -H "Authorization: Bearer TOKEN_NORMAL" http://localhost:3001/admin/organizations
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/admin/index.ts apps/api/src/server.ts
git commit -m "feat(admin): rotas /admin/* com guard de super-admin"
```

---

### Task 3: Componente AdminPanel (frontend)

**Files:**
- Create: `apps/web/src/app/(dashboard)/settings/billing/admin-panel.tsx`

**Interfaces consumidas (de Task 2):**
```typescript
// Tipos usados no componente
AdminOrgRow  // de @aula-agente/database (não importar diretamente — definir interface local no componente)
Plan         // de @aula-agente/shared
```

**Props do componente:**
```typescript
interface AdminPanelProps {
  orgs: AdminOrgRow[];
  plans: Plan[];
  onRefresh: () => void;
}
```

- [ ] **Step 1: Criar `apps/web/src/app/(dashboard)/settings/billing/admin-panel.tsx`**

```typescript
"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, RefreshCw, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api";
import type { Plan } from "@aula-agente/shared";

// Inline type — não importar de @aula-agente/database no app web
interface SubInfo {
  id: string; status: string; gateway: string | null; gateway_subscription_id: string | null;
  billing_interval: string; current_period_start: string | null; current_period_end: string | null;
  trial_end: string | null; cancelled_at: string | null; cancel_at_period_end: boolean;
  metadata: Record<string, unknown>;
  plan: { id: string; name: string; slug: string; price_monthly: number; price_yearly: number; max_agents: number; max_members: number; max_instances: number; } | null;
}
interface BillingEventRow {
  id: string; event_type: string; status: string; gateway: string | null; created_at: string; error_message: string | null;
}
interface AdminOrgRow {
  id: string; name: string; slug: string; onboarding_status: string; created_at: string; plan_id: string | null;
  owner_email: string | null; subscription: SubInfo | null; billing_events: BillingEventRow[];
}

interface AdminPanelProps {
  orgs: AdminOrgRow[];
  plans: Plan[];
  onRefresh: () => void;
}

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  active:    { text: "Ativa",    cls: "text-green-400 bg-green-400/10 border-green-400/30" },
  trial:     { text: "Trial",   cls: "text-blue-400 bg-blue-400/10 border-blue-400/30" },
  past_due:  { text: "Pendente",cls: "text-amber-400 bg-amber-400/10 border-amber-400/30" },
  paused:    { text: "Pausada", cls: "text-orange-400 bg-orange-400/10 border-orange-400/30" },
  cancelled: { text: "Cancelada",cls: "text-red-400 bg-red-400/10 border-red-400/30" },
};

const EVENT_STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  processed:  { text: "Ok",          cls: "text-green-400 bg-green-400/10 border-green-400/30" },
  pending:    { text: "Pendente",    cls: "text-amber-400 bg-amber-400/10 border-amber-400/30" },
  processing: { text: "Processando", cls: "text-amber-400 bg-amber-400/10 border-amber-400/30" },
  failed:     { text: "Falhou",      cls: "text-red-400 bg-red-400/10 border-red-400/30" },
  ignored:    { text: "Ignorado",    cls: "text-muted-foreground bg-muted border-border" },
};

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
}
function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

// Modal genérico de ação
function ActionModal({
  title, onClose, onConfirm, loading, children,
}: {
  title: string; onClose: () => void; onConfirm: () => void; loading: boolean; children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-5 shadow-xl">
        <h3 className="mb-4 text-sm font-semibold text-foreground">{title}</h3>
        <div className="space-y-3">{children}</div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-lg bg-foreground px-3 py-1.5 text-xs font-medium text-background hover:opacity-80 transition-opacity disabled:opacity-50"
          >
            {loading && <Loader2 className="h-3 w-3 animate-spin" />}
            Confirmar
          </button>
        </div>
      </div>
    </div>
  );
}

// Linha de uma organização (expansível)
function OrgRow({ org, plans, onRefresh }: { org: AdminOrgRow; plans: Plan[]; onRefresh: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [modal, setModal] = useState<"activate" | "change-plan" | "cancel" | null>(null);
  const [modalLoading, setModalLoading] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState(plans[0]?.id ?? "");
  const [selectedInterval, setSelectedInterval] = useState("manual");
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const sub = org.subscription;
  const statusCfg = STATUS_LABEL[sub?.status ?? ""] ?? null;

  const clearFeedback = () => { setActionError(null); setActionSuccess(null); };

  const handleActivate = async () => {
    setModalLoading(true);
    try {
      await apiFetch(`/admin/organizations/${org.id}/subscriptions`, {
        method: "POST",
        body: JSON.stringify({ plan_id: selectedPlan, billing_interval: selectedInterval }),
      });
      setModal(null);
      setActionSuccess("Assinatura criada com sucesso.");
      onRefresh();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setModalLoading(false);
    }
  };

  const handleChangePlan = async () => {
    if (!sub) return;
    setModalLoading(true);
    try {
      await apiFetch(`/admin/subscriptions/${sub.id}`, {
        method: "PATCH",
        body: JSON.stringify({ plan_id: selectedPlan }),
      });
      setModal(null);
      setActionSuccess("Plano atualizado.");
      onRefresh();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setModalLoading(false);
    }
  };

  const handleCancel = async () => {
    if (!sub) return;
    setModalLoading(true);
    try {
      await apiFetch(`/admin/subscriptions/${sub.id}`, { method: "DELETE" });
      setModal(null);
      setActionSuccess("Assinatura cancelada.");
      onRefresh();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setModalLoading(false);
    }
  };

  const handleResend = async () => {
    clearFeedback();
    try {
      const res = await apiFetch(`/admin/organizations/${org.id}/resend-invitation`, { method: "POST" }) as { message: string };
      setActionSuccess(res.message);
    } catch (e) {
      setActionError((e as Error).message);
    }
  };

  return (
    <>
      <tr
        className="cursor-pointer hover:bg-muted/20 transition-colors"
        onClick={() => { setExpanded((v) => !v); clearFeedback(); }}
      >
        <td className="px-4 py-3">
          {expanded ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
        </td>
        <td className="px-4 py-3">
          <p className="text-xs font-medium text-foreground">{org.name}</p>
          <p className="text-[11px] text-muted-foreground font-mono">{org.slug}</p>
        </td>
        <td className="px-4 py-3 text-xs text-muted-foreground">{org.owner_email ?? "—"}</td>
        <td className="px-4 py-3 text-xs text-foreground">{sub?.plan?.name ?? "—"}</td>
        <td className="px-4 py-3">
          {statusCfg ? (
            <span className={cn("rounded border px-2 py-0.5 text-[11px] font-semibold", statusCfg.cls)}>
              {statusCfg.text}
            </span>
          ) : <span className="text-xs text-muted-foreground">Sem assinatura</span>}
        </td>
        <td className="px-4 py-3 text-xs text-foreground capitalize">{sub?.gateway ?? "—"}</td>
        <td className="px-4 py-3 text-xs text-foreground">{fmtDate(sub?.current_period_end ?? null)}</td>
        <td className="px-4 py-3">
          <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
            {!sub ? (
              <button
                onClick={() => { clearFeedback(); setSelectedPlan(plans[0]?.id ?? ""); setSelectedInterval("manual"); setModal("activate"); }}
                className="rounded border border-green-500/40 px-2 py-1 text-[11px] font-medium text-green-400 hover:bg-green-500/10 transition-colors"
              >
                Ativar
              </button>
            ) : (
              <>
                <button
                  onClick={() => { clearFeedback(); setSelectedPlan(sub.plan?.id ?? plans[0]?.id ?? ""); setModal("change-plan"); }}
                  className="rounded border border-blue-500/40 px-2 py-1 text-[11px] font-medium text-blue-400 hover:bg-blue-500/10 transition-colors"
                >
                  Plano
                </button>
                <button
                  onClick={() => { clearFeedback(); setModal("cancel"); }}
                  className="rounded border border-destructive/40 px-2 py-1 text-[11px] font-medium text-destructive hover:bg-destructive/10 transition-colors"
                >
                  Cancelar
                </button>
              </>
            )}
            <button
              onClick={() => { clearFeedback(); handleResend(); }}
              className="rounded border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-accent transition-colors"
            >
              Reenviar
            </button>
          </div>
        </td>
      </tr>

      {/* Feedback row */}
      {(actionError || actionSuccess) && (
        <tr>
          <td colSpan={8} className="px-4 pb-2 pt-0">
            <p className={cn("text-[11px]", actionError ? "text-destructive" : "text-green-400")}>
              {actionError ?? actionSuccess}
            </p>
          </td>
        </tr>
      )}

      {/* Expanded details */}
      {expanded && (
        <tr>
          <td colSpan={8} className="bg-muted/10 px-4 py-3">
            <div className="space-y-3">
              {/* Subscription details */}
              {sub && (
                <div className="rounded-lg border border-border bg-card p-3 text-xs space-y-1">
                  <p className="font-semibold text-foreground mb-2">Assinatura</p>
                  <div className="grid grid-cols-2 gap-x-8 gap-y-1">
                    <span className="text-muted-foreground">ID</span><span className="font-mono text-[11px]">{sub.id}</span>
                    <span className="text-muted-foreground">Gateway Sub ID</span><span className="font-mono text-[11px]">{sub.gateway_subscription_id ?? "—"}</span>
                    <span className="text-muted-foreground">Intervalo</span><span>{sub.billing_interval}</span>
                    <span className="text-muted-foreground">Início</span><span>{fmtDate(sub.current_period_start)}</span>
                    <span className="text-muted-foreground">Fim</span><span>{fmtDate(sub.current_period_end)}</span>
                    <span className="text-muted-foreground">Trial até</span><span>{fmtDate(sub.trial_end)}</span>
                    <span className="text-muted-foreground">Cancelado em</span><span>{fmtDate(sub.cancelled_at)}</span>
                    <span className="text-muted-foreground">Cancel no fim</span><span>{sub.cancel_at_period_end ? "Sim" : "Não"}</span>
                  </div>
                  {Object.keys(sub.metadata).length > 0 && (
                    <div className="mt-2">
                      <p className="text-muted-foreground mb-1">Metadata</p>
                      <pre className="rounded bg-muted p-2 text-[10px] overflow-x-auto">{JSON.stringify(sub.metadata, null, 2)}</pre>
                    </div>
                  )}
                </div>
              )}

              {/* Billing events */}
              <div className="rounded-lg border border-border bg-card overflow-hidden">
                <p className="border-b border-border px-3 py-2 text-[11px] font-semibold text-foreground">
                  Últimos eventos ({org.billing_events.length})
                </p>
                {org.billing_events.length === 0 ? (
                  <p className="p-3 text-xs text-muted-foreground">Nenhum evento.</p>
                ) : (
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border bg-muted/30">
                        {["Data", "Tipo", "Gateway", "Status", "Erro"].map((h) => (
                          <th key={h} className="px-3 py-1.5 text-left text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {org.billing_events.map((ev) => {
                        const s = EVENT_STATUS_LABEL[ev.status] ?? { text: ev.status, cls: "text-muted-foreground border-border" };
                        return (
                          <tr key={ev.id} className="hover:bg-muted/20">
                            <td className="px-3 py-1.5 whitespace-nowrap">{fmtDateTime(ev.created_at)}</td>
                            <td className="px-3 py-1.5">{ev.event_type.replace(/_/g, " ")}</td>
                            <td className="px-3 py-1.5 capitalize">{ev.gateway ?? "—"}</td>
                            <td className="px-3 py-1.5">
                              <span className={cn("rounded border px-1.5 py-0.5 text-[10px] font-semibold", s.cls)}>{s.text}</span>
                            </td>
                            <td className="px-3 py-1.5 text-destructive text-[10px] max-w-[200px] truncate">{ev.error_message ?? "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}

      {/* Modais */}
      {modal === "activate" && (
        <ActionModal title="Ativar assinatura manual" onClose={() => setModal(null)} onConfirm={handleActivate} loading={modalLoading}>
          <div className="space-y-2">
            <label className="block text-xs text-muted-foreground">Plano</label>
            <select
              value={selectedPlan}
              onChange={(e) => setSelectedPlan(e.target.value)}
              className="w-full rounded-lg border border-border bg-muted px-3 py-2 text-xs text-foreground"
            >
              {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className="space-y-2">
            <label className="block text-xs text-muted-foreground">Intervalo</label>
            <select
              value={selectedInterval}
              onChange={(e) => setSelectedInterval(e.target.value)}
              className="w-full rounded-lg border border-border bg-muted px-3 py-2 text-xs text-foreground"
            >
              {["manual", "monthly", "yearly", "lifetime"].map((i) => (
                <option key={i} value={i}>{i}</option>
              ))}
            </select>
          </div>
          {actionError && <p className="text-[11px] text-destructive">{actionError}</p>}
        </ActionModal>
      )}

      {modal === "change-plan" && (
        <ActionModal title="Mudar plano" onClose={() => setModal(null)} onConfirm={handleChangePlan} loading={modalLoading}>
          <div className="space-y-2">
            <label className="block text-xs text-muted-foreground">Novo plano</label>
            <select
              value={selectedPlan}
              onChange={(e) => setSelectedPlan(e.target.value)}
              className="w-full rounded-lg border border-border bg-muted px-3 py-2 text-xs text-foreground"
            >
              {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          {actionError && <p className="text-[11px] text-destructive">{actionError}</p>}
        </ActionModal>
      )}

      {modal === "cancel" && (
        <ActionModal title="Cancelar assinatura" onClose={() => setModal(null)} onConfirm={handleCancel} loading={modalLoading}>
          <p className="text-xs text-muted-foreground">
            Tem certeza que deseja cancelar a assinatura de <strong className="text-foreground">{org.name}</strong>?
            Esta ação define status = "cancelled" imediatamente.
          </p>
          {actionError && <p className="text-[11px] text-destructive">{actionError}</p>}
        </ActionModal>
      )}
    </>
  );
}

export function AdminPanel({ orgs, plans, onRefresh }: AdminPanelProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Todas as organizações</h2>
          <p className="text-xs text-muted-foreground mt-0.5">{orgs.length} organização{orgs.length !== 1 ? "s" : ""}</p>
        </div>
        <button
          onClick={onRefresh}
          className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent transition-colors"
        >
          <RefreshCw className="h-3 w-3" /> Atualizar
        </button>
      </div>

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="w-6 px-4 py-2.5" />
                {["Organização", "Owner", "Plano", "Status", "Gateway", "Vencimento", "Ações"].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-left text-[10px] font-medium uppercase tracking-wider text-muted-foreground whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {orgs.map((org) => (
                <OrgRow key={org.id} org={org} plans={plans} onRefresh={onRefresh} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: TypeScript check do web**

```bash
pnpm -r exec tsc --noEmit 2>&1 | Select-String "error TS"
```
Esperado: sem erros.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/(dashboard)/settings/billing/admin-panel.tsx
git commit -m "feat(admin): componente AdminPanel com tabela de orgs e ações"
```

---

### Task 4: Integrar AdminPanel na página de billing

**Files:**
- Modify: `apps/web/src/app/(dashboard)/settings/billing/page.tsx`

**Interfaces consumidas (de Task 3):**
- `AdminPanel` de `./admin-panel`
- Tipos inline `AdminOrgRow` e `Plan` no estado local

- [ ] **Step 1: Adicionar estado e fetch de admin em `page.tsx`**

Substituir o início do componente `BillingPage` (do `export default` até o final do segundo `useEffect`) com:

```typescript
export default function BillingPage() {
  const { currentOrg, currentRole, loading: orgLoading } = useOrganization();
  const router = useRouter();
  const [data, setData] = useState<BillingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Super-admin state
  const [adminData, setAdminData] = useState<{ orgs: AdminOrgRow[]; plans: Plan[] } | null>(null);
  const [activeTab, setActiveTab] = useState<"billing" | "admin">("billing");

  const isAdmin = currentRole === "owner" || currentRole === "admin";

  useEffect(() => {
    if (!orgLoading && currentOrg !== null && !isAdmin) {
      router.replace("/inbox");
    }
  }, [orgLoading, currentOrg, isAdmin, router]);

  const load = useCallback(() => {
    if (!currentOrg) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    apiFetch("/billing/subscription", { headers: { "x-organization-id": currentOrg.id } })
      .then((res) => { setData(res as BillingData); setLoading(false); })
      .catch((err: Error) => { setError(err.message); setLoading(false); });
  }, [currentOrg]);

  const loadAdmin = useCallback(() => {
    apiFetch("/admin/organizations")
      .then((res) => setAdminData(res as { orgs: AdminOrgRow[]; plans: Plan[] }))
      .catch(() => { /* 403 para usuários normais — ignorar silenciosamente */ });
  }, []);

  useEffect(() => {
    if (orgLoading) return;
    if (!currentOrg) { setLoading(false); return; }
    load();
    loadAdmin();
  }, [currentOrg, orgLoading, load, loadAdmin]);
```

- [ ] **Step 2: Adicionar imports e tipos no topo de `page.tsx`**

Adicionar ao bloco de imports existente:

```typescript
import { AdminPanel } from "./admin-panel";

// Local types for admin data
interface AdminOrgRow {
  id: string; name: string; slug: string; onboarding_status: string; created_at: string; plan_id: string | null;
  owner_email: string | null;
  subscription: {
    id: string; status: string; gateway: string | null; gateway_subscription_id: string | null;
    billing_interval: string; current_period_start: string | null; current_period_end: string | null;
    trial_end: string | null; cancelled_at: string | null; cancel_at_period_end: boolean;
    metadata: Record<string, unknown>;
    plan: { id: string; name: string; slug: string; price_monthly: number; price_yearly: number; max_agents: number; max_members: number; max_instances: number; } | null;
  } | null;
  billing_events: Array<{ id: string; event_type: string; status: string; gateway: string | null; created_at: string; error_message: string | null; }>;
}
```

- [ ] **Step 3: Adicionar tab switcher e renderização condicional em `page.tsx`**

No JSX do `return`, substituir o `<div className="mx-auto max-w-2xl space-y-5">` e o `{/* Header */}` por:

```tsx
  return (
    <div className="mx-auto max-w-4xl space-y-5">

      {/* Tab switcher — aparece só para super-admin */}
      {adminData && (
        <div className="flex gap-1 rounded-lg border border-border bg-muted/30 p-1 w-fit">
          {(["billing", "admin"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                "rounded-md px-4 py-1.5 text-xs font-medium transition-colors",
                activeTab === tab
                  ? "bg-card border border-border text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {tab === "billing" ? "Minha assinatura" : "Admin"}
            </button>
          ))}
        </div>
      )}

      {/* Admin tab */}
      {adminData && activeTab === "admin" && (
        <AdminPanel orgs={adminData.orgs} plans={adminData.plans} onRefresh={loadAdmin} />
      )}

      {/* Billing tab normal */}
      {activeTab === "billing" && (
        <>
          {/* Header */}
          <div className="flex items-center justify-between">
```

E fechar os tags corretamente com `</>` e `</div>` no final do componente (envolvendo o conteúdo do billing tab existente).

> **Atenção:** O conteúdo original da página (Cards de Plano atual, Utilização e Histórico) fica dentro do bloco `{activeTab === "billing" && (<>...</>)}`. Mover o `</div>` de fechamento do `max-w-2xl` para fora do bloco `billing`.

- [ ] **Step 4: TypeScript check final**

```bash
pnpm -r exec tsc --noEmit 2>&1 | Select-String "error TS"
```
Esperado: sem erros.

- [ ] **Step 5: Teste visual**

1. Rodar `pnpm dev` no `apps/web`
2. Logar com o email do `SUPER_ADMIN_EMAIL`
3. Acessar `/settings/billing`
4. Verificar: aba "Admin" aparece ao lado de "Minha assinatura"
5. Clicar em "Admin": tabela de orgs carrega com colunas corretas
6. Expandir uma org: ver detalhes da subscription e billing_events
7. Testar ação "Ativar" numa org sem assinatura
8. Logar com um usuário normal: verificar que aba Admin não aparece

- [ ] **Step 6: Commit final**

```bash
git add apps/web/src/app/(dashboard)/settings/billing/page.tsx
git commit -m "feat(admin): integrar AdminPanel na página de billing com tab switcher"
```
