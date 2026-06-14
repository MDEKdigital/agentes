# Remarketing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar o módulo de Remarketing completo — banco, worker de polling, API REST e UI — permitindo que cada organização configure fluxos automáticos de recuperação para clientes que pararam de responder.

**Architecture:** Polling worker BullMQ com concurrency:1 rodando a cada minuto detecta conversas silenciosas (sem mensagem `role='contact'` no período configurado), cria enrollments e avança etapas. A API Fastify expõe CRUD completo com restrições de role e validação de ownership. O frontend Next.js adiciona Remarketing ao menu lateral e oferece lista + editor de fluxos.

**Tech Stack:** PostgreSQL/Supabase (migrations SQL), BullMQ + Redis (worker), Fastify (API), Next.js 15 App Router + Supabase client (frontend), TypeScript monorepo pnpm/turbo.

---

## File Map

### Criar
- `supabase/migrations/00021_remarketing.sql` — 3 tabelas + constraints + índices
- `packages/shared/src/types/remarketing.ts` — tipos TypeScript das entidades
- `packages/queue/src/types.ts` — adicionar `RemarketingJobData` (modificar existente)
- `packages/shared/src/constants.ts` — adicionar `REMARKETING` em `QUEUE_NAMES` (modificar)
- `packages/shared/src/types/index.ts` — re-exportar remarketing types (modificar)
- `packages/queue/src/queues.ts` — adicionar `getRemarketingQueue()` (modificar)
- `packages/queue/src/index.ts` — exportar nova fila (modificar)
- `packages/database/src/queries/remarketing.ts` — query helpers para o worker
- `packages/database/src/queries/index.ts` — re-exportar (modificar)
- `apps/worker/src/workers/remarketing-worker.ts` — polling worker
- `apps/worker/src/index.ts` — registrar worker (modificar)
- `apps/api/src/routes/remarketing/flows.ts` — rotas de fluxos
- `apps/api/src/routes/remarketing/steps.ts` — rotas de etapas
- `apps/api/src/routes/remarketing/index.ts` — registrar rotas do módulo
- `apps/api/src/server.ts` — registrar módulo (modificar)
- `apps/web/src/app/(dashboard)/remarketing/page.tsx` — tela de listagem
- `apps/web/src/app/(dashboard)/remarketing/[flowId]/edit/page.tsx` — tela de edição
- `apps/web/src/components/remarketing/flow-list.tsx` — lista de fluxos
- `apps/web/src/components/remarketing/flow-form.tsx` — formulário esquerdo
- `apps/web/src/components/remarketing/steps-editor.tsx` — editor de etapas
- `apps/web/src/components/layout/app-sidebar.tsx` — adicionar item (modificar)

---

## Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/00021_remarketing.sql`

- [ ] **Step 1: Criar o arquivo de migration**

```sql
-- supabase/migrations/00021_remarketing.sql

-- ─── remarketing_flows ────────────────────────────────────────────────────────
CREATE TABLE remarketing_flows (
  id                     uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id        uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name                   text NOT NULL,
  product_campaign       text NOT NULL DEFAULT '',
  agent_id               uuid NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
  instance_id            uuid NOT NULL REFERENCES evolution_instances(id) ON DELETE RESTRICT,
  status                 text NOT NULL DEFAULT 'inactive'
                           CHECK (status IN ('active', 'inactive')),
  entry_silence_minutes  integer NOT NULL DEFAULT 15
                           CHECK (entry_silence_minutes > 0),
  cancel_on_reply        boolean NOT NULL DEFAULT true,
  cancel_on_resolved     boolean NOT NULL DEFAULT true,
  cancel_on_opt_out      boolean NOT NULL DEFAULT true,
  last_executed_at       timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

-- ─── remarketing_steps ────────────────────────────────────────────────────────
CREATE TABLE remarketing_steps (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  flow_id          uuid NOT NULL REFERENCES remarketing_flows(id) ON DELETE CASCADE,
  step_order       integer NOT NULL CHECK (step_order > 0),
  wait_minutes     integer NOT NULL DEFAULT 60 CHECK (wait_minutes >= 0),
  message_type     text NOT NULL DEFAULT 'text'
                     CHECK (message_type IN ('text', 'audio', 'image')),
  message_content  text NOT NULL DEFAULT '',
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (flow_id, step_order)
);

-- ─── remarketing_enrollments ──────────────────────────────────────────────────
CREATE TABLE remarketing_enrollments (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  flow_id           uuid NOT NULL REFERENCES remarketing_flows(id) ON DELETE CASCADE,
  conversation_id   uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  organization_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  next_step_id      uuid REFERENCES remarketing_steps(id) ON DELETE SET NULL,
  enrolled_at       timestamptz NOT NULL DEFAULT now(),
  last_step_sent_at timestamptz,
  status            text NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active', 'completed', 'cancelled')),
  cancel_reason     text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- ─── Constraints ──────────────────────────────────────────────────────────────
-- Garante que uma conversa só tem um enrollment active por vez (enforced pelo banco)
CREATE UNIQUE INDEX idx_remarketing_enrollments_unique_active
  ON remarketing_enrollments (conversation_id)
  WHERE status = 'active';

-- ─── Indexes para queries do worker ───────────────────────────────────────────
CREATE INDEX idx_remarketing_flows_org_status
  ON remarketing_flows (organization_id, status);

CREATE INDEX idx_remarketing_enrollments_active
  ON remarketing_enrollments (status, next_step_id)
  WHERE status = 'active';

-- Índice que acelera a verificação de silêncio (Passo 1 do worker)
CREATE INDEX idx_messages_conversation_role_created
  ON messages (conversation_id, role, created_at);

-- ─── Trigger updated_at ───────────────────────────────────────────────────────
CREATE TRIGGER trg_remarketing_flows_updated_at
  BEFORE UPDATE ON remarketing_flows
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE remarketing_flows ENABLE ROW LEVEL SECURITY;
ALTER TABLE remarketing_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE remarketing_enrollments ENABLE ROW LEVEL SECURITY;
```

- [ ] **Step 2: Aplicar a migration**

```bash
npx supabase db push
```

Resultado esperado: `Applied 1 migration` sem erros.

- [ ] **Step 3: Verificar as tabelas no Supabase Studio**

Abra o Supabase Studio → Table Editor e confirme que `remarketing_flows`, `remarketing_steps` e `remarketing_enrollments` existem com as colunas corretas.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/00021_remarketing.sql
git commit -m "feat: migration das tabelas de remarketing"
```

---

## Task 2: Tipos Compartilhados (packages/shared)

**Files:**
- Create: `packages/shared/src/types/remarketing.ts`
- Modify: `packages/shared/src/types/index.ts`
- Modify: `packages/shared/src/constants.ts`

- [ ] **Step 1: Criar os tipos TypeScript**

```typescript
// packages/shared/src/types/remarketing.ts
export type RemarketingFlowStatus = 'active' | 'inactive';
export type RemarketingMessageType = 'text' | 'audio' | 'image';
export type RemarketingEnrollmentStatus = 'active' | 'completed' | 'cancelled';

export interface RemarketingFlow {
  id: string;
  organization_id: string;
  name: string;
  product_campaign: string;
  agent_id: string;
  instance_id: string;
  status: RemarketingFlowStatus;
  entry_silence_minutes: number;
  cancel_on_reply: boolean;
  cancel_on_resolved: boolean;
  cancel_on_opt_out: boolean;
  last_executed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface RemarketingStep {
  id: string;
  flow_id: string;
  step_order: number;
  wait_minutes: number;
  message_type: RemarketingMessageType;
  message_content: string;
  is_active: boolean;
  created_at: string;
}

export interface RemarketingEnrollment {
  id: string;
  flow_id: string;
  conversation_id: string;
  organization_id: string;
  next_step_id: string | null;
  enrolled_at: string;
  last_step_sent_at: string | null;
  status: RemarketingEnrollmentStatus;
  cancel_reason: string | null;
  created_at: string;
}
```

- [ ] **Step 2: Re-exportar em index.ts**

Abra `packages/shared/src/types/index.ts` e adicione ao final:

```typescript
export * from "./remarketing";
```

- [ ] **Step 3: Adicionar REMARKETING ao QUEUE_NAMES**

Abra `packages/shared/src/constants.ts` e altere o objeto `QUEUE_NAMES`:

```typescript
export const QUEUE_NAMES = {
  PROCESS_MESSAGE: "process-message",
  SEND_MESSAGE: "send-message",
  PROCESS_DOCUMENT: "process-document",
  TAKEOVER_TIMEOUT: "takeover-timeout",
  REMARKETING: "remarketing",
} as const;
```

- [ ] **Step 4: Build do pacote para verificar tipos**

```bash
cd packages/shared && pnpm build
```

Resultado esperado: sem erros de TypeScript.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/types/remarketing.ts packages/shared/src/types/index.ts packages/shared/src/constants.ts
git commit -m "feat: tipos e constantes de remarketing em packages/shared"
```

---

## Task 3: Queue Package

**Files:**
- Modify: `packages/queue/src/types.ts`
- Modify: `packages/queue/src/queues.ts`
- Modify: `packages/queue/src/index.ts`

- [ ] **Step 1: Adicionar RemarketingJobData em types.ts**

Abra `packages/queue/src/types.ts` e adicione ao final:

```typescript
export interface RemarketingJobData {
  // sem dados — o worker varre todos os enrollments ativos
}
```

- [ ] **Step 2: Adicionar getRemarketingQueue() em queues.ts**

Abra `packages/queue/src/queues.ts`. Adicione a variável e a função ao final do arquivo (antes do último export, se houver):

```typescript
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let remarketingQueue: Queue<RemarketingJobData, any, string> | null = null;

export function getRemarketingQueue() {
  if (!remarketingQueue) {
    remarketingQueue = new Queue<RemarketingJobData>(QUEUE_NAMES.REMARKETING, {
      connection: getConnectionOptions(),
    });
  }
  return remarketingQueue;
}
```

Adicione também o import do tipo no topo do arquivo (junto aos outros imports de types):

```typescript
import type {
  ProcessMessageJobData,
  SendMessageJobData,
  ProcessDocumentJobData,
  TakeoverTimeoutJobData,
  RemarketingJobData,
} from "./types";
```

- [ ] **Step 3: Exportar a nova fila em index.ts**

Abra `packages/queue/src/index.ts` e confirme que re-exporta tudo de queues e types (o padrão já deve estar lá). Se precisar:

```typescript
export * from "./queues";
export * from "./types";
export * from "./connection";
```

- [ ] **Step 4: Build do pacote**

```bash
cd packages/queue && pnpm build
```

Resultado esperado: sem erros de TypeScript.

- [ ] **Step 5: Commit**

```bash
git add packages/queue/src/types.ts packages/queue/src/queues.ts packages/queue/src/index.ts
git commit -m "feat: fila getRemarketingQueue() em packages/queue"
```

---

## Task 4: Database Query Helpers

**Files:**
- Create: `packages/database/src/queries/remarketing.ts`
- Modify: `packages/database/src/queries/index.ts`

- [ ] **Step 1: Criar o arquivo de queries**

```typescript
// packages/database/src/queries/remarketing.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  RemarketingFlow,
  RemarketingStep,
  RemarketingEnrollment,
} from "@aula-agente/shared";

const OPT_OUT_KEYWORDS = [
  "pare", "parar", "stop", "cancelar", "não quero",
  "nao quero", "chega", "sair", "remover", "descadastrar",
];

export async function getActiveRemarketingFlows(
  client: SupabaseClient
): Promise<RemarketingFlow[]> {
  const { data, error } = await client
    .from("remarketing_flows")
    .select("*")
    .eq("status", "active");
  if (error) throw error;
  return (data as RemarketingFlow[]) ?? [];
}

export async function getFirstActiveStep(
  client: SupabaseClient,
  flowId: string
): Promise<RemarketingStep | null> {
  const { data, error } = await client
    .from("remarketing_steps")
    .select("*")
    .eq("flow_id", flowId)
    .eq("is_active", true)
    .order("step_order", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data as RemarketingStep | null;
}

export async function getNextActiveStep(
  client: SupabaseClient,
  flowId: string,
  afterStepOrder: number
): Promise<RemarketingStep | null> {
  const { data, error } = await client
    .from("remarketing_steps")
    .select("*")
    .eq("flow_id", flowId)
    .eq("is_active", true)
    .gt("step_order", afterStepOrder)
    .order("step_order", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data as RemarketingStep | null;
}

export async function getConversationsEligibleForEnrollment(
  client: SupabaseClient,
  flow: RemarketingFlow
): Promise<{ id: string; organization_id: string }[]> {
  const silenceCutoff = new Date(
    Date.now() - flow.entry_silence_minutes * 60 * 1000
  ).toISOString();

  // Conversas abertas com o agente e instância do fluxo
  const { data: conversations, error } = await client
    .from("conversations")
    .select("id, organization_id")
    .eq("agent_id", flow.agent_id)
    .eq("evolution_instance_id", flow.instance_id)
    .eq("organization_id", flow.organization_id)
    .in("status", ["open", "waiting"]);

  if (error) throw error;
  if (!conversations || conversations.length === 0) return [];

  // Excluir conversas que já têm enrollment active
  const { data: enrolled } = await client
    .from("remarketing_enrollments")
    .select("conversation_id")
    .in(
      "conversation_id",
      conversations.map((c) => c.id)
    )
    .eq("status", "active");

  const enrolledIds = new Set((enrolled ?? []).map((e) => e.conversation_id));
  const candidates = conversations.filter((c) => !enrolledIds.has(c.id));
  if (candidates.length === 0) return [];

  // Filtrar pelo silêncio: sem mensagem role='contact' desde o cutoff
  const eligible: { id: string; organization_id: string }[] = [];
  for (const conv of candidates) {
    const { count, error: msgErr } = await client
      .from("messages")
      .select("*", { count: "exact", head: true })
      .eq("conversation_id", conv.id)
      .eq("role", "contact")
      .gt("created_at", silenceCutoff);

    if (msgErr) throw msgErr;
    if (count === 0) eligible.push(conv);
  }
  return eligible;
}

export async function createEnrollment(
  client: SupabaseClient,
  data: {
    flow_id: string;
    conversation_id: string;
    organization_id: string;
    next_step_id: string;
  }
): Promise<RemarketingEnrollment> {
  const { data: enrollment, error } = await client
    .from("remarketing_enrollments")
    .insert({ ...data, status: "active" })
    .select()
    .single();
  if (error) throw error;
  return enrollment as RemarketingEnrollment;
}

export async function getActiveEnrollments(
  client: SupabaseClient
): Promise<RemarketingEnrollment[]> {
  const { data, error } = await client
    .from("remarketing_enrollments")
    .select("*")
    .eq("status", "active")
    .not("next_step_id", "is", null);
  if (error) throw error;
  return (data as RemarketingEnrollment[]) ?? [];
}

export async function getStepById(
  client: SupabaseClient,
  stepId: string
): Promise<RemarketingStep | null> {
  const { data, error } = await client
    .from("remarketing_steps")
    .select("*")
    .eq("id", stepId)
    .maybeSingle();
  if (error) throw error;
  return data as RemarketingStep | null;
}

export async function cancelEnrollment(
  client: SupabaseClient,
  enrollmentId: string,
  reason: string
): Promise<void> {
  const { error } = await client
    .from("remarketing_enrollments")
    .update({ status: "cancelled", cancel_reason: reason })
    .eq("id", enrollmentId);
  if (error) throw error;
}

export async function advanceEnrollment(
  client: SupabaseClient,
  enrollmentId: string,
  nextStepId: string | null
): Promise<void> {
  const { error } = await client
    .from("remarketing_enrollments")
    .update({
      next_step_id: nextStepId,
      last_step_sent_at: new Date().toISOString(),
      status: nextStepId === null ? "completed" : "active",
    })
    .eq("id", enrollmentId);
  if (error) throw error;
}

export async function updateFlowLastExecuted(
  client: SupabaseClient,
  flowId: string
): Promise<void> {
  const { error } = await client
    .from("remarketing_flows")
    .update({ last_executed_at: new Date().toISOString() })
    .eq("id", flowId);
  if (error) throw error;
}

export async function hasContactRepliedSince(
  client: SupabaseClient,
  conversationId: string,
  since: string
): Promise<boolean> {
  const { count, error } = await client
    .from("messages")
    .select("*", { count: "exact", head: true })
    .eq("conversation_id", conversationId)
    .eq("role", "contact")
    .gt("created_at", since);
  if (error) throw error;
  return (count ?? 0) > 0;
}

export async function getLastContactMessage(
  client: SupabaseClient,
  conversationId: string
): Promise<{ content: string } | null> {
  const { data, error } = await client
    .from("messages")
    .select("content")
    .eq("conversation_id", conversationId)
    .eq("role", "contact")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export function isOptOutMessage(content: string): boolean {
  const lower = content.toLowerCase();
  return OPT_OUT_KEYWORDS.some((kw) => lower.includes(kw));
}

export async function isConversationResolved(
  client: SupabaseClient,
  conversationId: string
): Promise<boolean> {
  const { data, error } = await client
    .from("conversations")
    .select("status")
    .eq("id", conversationId)
    .single();
  if (error) throw error;
  return data?.status === "resolved" || data?.status === "closed";
}

export async function returnConversationToAgent(
  client: SupabaseClient,
  conversationId: string,
  agentId: string
): Promise<void> {
  const { error } = await client
    .from("conversations")
    .update({ agent_id: agentId, status: "open" })
    .eq("id", conversationId);
  if (error) throw error;
}
```

- [ ] **Step 2: Adicionar re-export em queries/index.ts**

Abra `packages/database/src/queries/index.ts` e adicione ao final:

```typescript
export * from "./remarketing";
```

- [ ] **Step 3: Build do pacote**

```bash
cd packages/database && pnpm build
```

Resultado esperado: sem erros de TypeScript.

- [ ] **Step 4: Commit**

```bash
git add packages/database/src/queries/remarketing.ts packages/database/src/queries/index.ts
git commit -m "feat: query helpers de remarketing em packages/database"
```

---

## Task 5: Remarketing Worker

**Files:**
- Create: `apps/worker/src/workers/remarketing-worker.ts`

- [ ] **Step 1: Criar o worker**

```typescript
// apps/worker/src/workers/remarketing-worker.ts
import { Worker, type Job } from "bullmq";
import { QUEUE_NAMES } from "@aula-agente/shared";
import type { RemarketingJobData } from "@aula-agente/queue";
import { getRemarketingQueue } from "@aula-agente/queue";
import { getConnectionOptions } from "../lib/redis";
import { getAdminClient } from "@aula-agente/database";
import {
  getActiveRemarketingFlows,
  getFirstActiveStep,
  getNextActiveStep,
  getConversationsEligibleForEnrollment,
  createEnrollment,
  getActiveEnrollments,
  getStepById,
  cancelEnrollment,
  advanceEnrollment,
  updateFlowLastExecuted,
  hasContactRepliedSince,
  getLastContactMessage,
  isOptOutMessage,
  isConversationResolved,
  returnConversationToAgent,
} from "@aula-agente/database";

async function processRemarketingCycle() {
  const db = getAdminClient();

  // ── Passo 1: Detectar novas entradas ──────────────────────────────────────
  const flows = await getActiveRemarketingFlows(db);

  for (const flow of flows) {
    try {
      const eligible = await getConversationsEligibleForEnrollment(db, flow);
      for (const conv of eligible) {
        const firstStep = await getFirstActiveStep(db, flow.id);
        if (!firstStep) continue;
        try {
          await createEnrollment(db, {
            flow_id: flow.id,
            conversation_id: conv.id,
            organization_id: conv.organization_id,
            next_step_id: firstStep.id,
          });
          console.log(`[remarketing] Enrolled conversation ${conv.id} in flow ${flow.id}`);
        } catch (err: unknown) {
          // Unique constraint violation: conversa já foi enrollada por execução concorrente
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes("unique") || msg.includes("duplicate")) {
            console.log(`[remarketing] Skipping duplicate enrollment for conversation ${conv.id}`);
          } else {
            throw err;
          }
        }
      }
    } catch (err) {
      console.error(`[remarketing] Error processing flow ${flow.id}:`, err);
    }
  }

  // ── Passo 2: Processar etapas pendentes ───────────────────────────────────
  const enrollments = await getActiveEnrollments(db);

  for (const enrollment of enrollments) {
    try {
      if (!enrollment.next_step_id) continue;

      const step = await getStepById(db, enrollment.next_step_id);
      if (!step) {
        await cancelEnrollment(db, enrollment.id, "step_not_found");
        continue;
      }

      // Verificar timer
      const reference = enrollment.last_step_sent_at ?? enrollment.enrolled_at;
      const readyAt = new Date(reference).getTime() + step.wait_minutes * 60 * 1000;
      if (Date.now() < readyAt) continue;

      // ── Verificar regras de cancelamento ──────────────────────────────────

      // Conversa resolvida/fechada
      const resolved = await isConversationResolved(db, enrollment.conversation_id);
      if (resolved) {
        await cancelEnrollment(db, enrollment.id, "resolved");
        console.log(`[remarketing] Cancelled enrollment ${enrollment.id}: conversation resolved`);
        continue;
      }

      // Cliente respondeu após o enrollment
      const flow = flows.find((f) => f.id === enrollment.flow_id);
      if (flow?.cancel_on_reply) {
        const replied = await hasContactRepliedSince(
          db,
          enrollment.conversation_id,
          enrollment.enrolled_at
        );
        if (replied) {
          await cancelEnrollment(db, enrollment.id, "reply");
          await returnConversationToAgent(db, enrollment.conversation_id, flow.agent_id);
          console.log(`[remarketing] Cancelled enrollment ${enrollment.id}: client replied`);
          continue;
        }
      }

      // Cliente pediu opt-out (última mensagem do contato)
      if (flow?.cancel_on_opt_out) {
        const lastMsg = await getLastContactMessage(db, enrollment.conversation_id);
        if (lastMsg && isOptOutMessage(lastMsg.content)) {
          await cancelEnrollment(db, enrollment.id, "opt_out");
          console.log(`[remarketing] Cancelled enrollment ${enrollment.id}: opt-out detected`);
          continue;
        }
      }

      // ── Enviar mensagem ────────────────────────────────────────────────────
      // Registra a mensagem na tabela messages (role: 'agent')
      const { error: msgError } = await db.from("messages").insert({
        conversation_id: enrollment.conversation_id,
        organization_id: enrollment.organization_id,
        role: "agent",
        content: step.message_content,
        ...(step.message_type !== "text" && { media_url: step.message_content, media_type: step.message_type }),
      });

      if (msgError) throw msgError;

      console.log(
        `[remarketing] Sent step ${step.step_order} to conversation ${enrollment.conversation_id}`
      );

      // ── Avançar para próxima etapa ─────────────────────────────────────────
      const nextStep = await getNextActiveStep(db, enrollment.flow_id, step.step_order);
      await advanceEnrollment(db, enrollment.id, nextStep?.id ?? null);
      await updateFlowLastExecuted(db, enrollment.flow_id);
    } catch (err) {
      console.error(`[remarketing] Error processing enrollment ${enrollment.id}:`, err);
    }
  }
}

export function startRemarketingWorker() {
  const worker = new Worker<RemarketingJobData>(
    QUEUE_NAMES.REMARKETING,
    async (_job: Job) => {
      await processRemarketingCycle();
    },
    {
      connection: getConnectionOptions(),
      concurrency: 1,
    }
  );

  const queue = getRemarketingQueue();
  queue.upsertJobScheduler(
    "remarketing-scheduler",
    { every: 60 * 1000 },
    { name: "check-remarketing" }
  );

  worker.on("failed", (job, err) => {
    console.error(`[remarketing] Job ${job?.id} failed:`, err.message);
  });

  console.log("Remarketing worker started (runs every 1 min)");
  return worker;
}
```

- [ ] **Step 2: Verificar tipos com build**

```bash
cd apps/worker && pnpm build 2>&1 | head -30
```

Resultado esperado: sem erros de TypeScript relativos ao remarketing-worker.ts.

- [ ] **Step 3: Commit**

```bash
git add apps/worker/src/workers/remarketing-worker.ts
git commit -m "feat: remarketing polling worker com concurrency:1"
```

---

## Task 6: Registrar Worker

**Files:**
- Modify: `apps/worker/src/index.ts`

- [ ] **Step 1: Adicionar o import e registrar o worker**

Abra `apps/worker/src/index.ts`. Adicione o import junto aos outros:

```typescript
import { startRemarketingWorker } from "./workers/remarketing-worker";
```

Adicione `startRemarketingWorker()` ao array `workers`:

```typescript
const workers = [
  startProcessMessageWorker(),
  startSendMessageWorker(),
  startProcessDocumentWorker(),
  startTakeoverTimeoutWorker(),
  startRemarketingWorker(),
];
```

- [ ] **Step 2: Build final do worker**

```bash
cd apps/worker && pnpm build
```

Resultado esperado: sem erros.

- [ ] **Step 3: Commit**

```bash
git add apps/worker/src/index.ts
git commit -m "feat: registrar remarketing worker no processo de workers"
```

---

## Task 7: API — Rotas de Fluxos

**Files:**
- Create: `apps/api/src/routes/remarketing/flows.ts`

- [ ] **Step 1: Criar o arquivo de rotas de fluxos**

```typescript
// apps/api/src/routes/remarketing/flows.ts
import type { FastifyInstance } from "fastify";
import { getAdminClient } from "@aula-agente/database";
import { authMiddleware } from "../../middleware/auth";

export default async function remarketingFlowRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authMiddleware);

  // ── GET /remarketing/flows ─────────────────────────────────────────────────
  app.get("/remarketing/flows", async (request, reply) => {
    const orgId = request.headers["x-organization-id"] as string;
    if (!orgId) return reply.status(400).send({ error: "x-organization-id obrigatório" });

    const membership = request.user.memberships.find((m) => m.organization_id === orgId);
    if (!membership) return reply.status(403).send({ error: "Acesso negado" });

    const db = getAdminClient();
    const { data, error } = await db
      .from("remarketing_flows")
      .select("*, remarketing_steps(count)")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false });

    if (error) return reply.status(500).send({ error: "Erro ao listar fluxos" });
    return reply.send(data);
  });

  // ── POST /remarketing/flows ────────────────────────────────────────────────
  app.post<{
    Body: {
      name: string;
      product_campaign: string;
      agent_id: string;
      instance_id: string;
      entry_silence_minutes: number;
      cancel_on_reply?: boolean;
      cancel_on_resolved?: boolean;
      cancel_on_opt_out?: boolean;
    };
  }>("/remarketing/flows", async (request, reply) => {
    const orgId = request.headers["x-organization-id"] as string;
    if (!orgId) return reply.status(400).send({ error: "x-organization-id obrigatório" });

    const membership = request.user.memberships.find(
      (m) => m.organization_id === orgId && m.role !== "agent"
    );
    if (!membership) return reply.status(403).send({ error: "Acesso de administrador necessário" });

    const { name, product_campaign, agent_id, instance_id, entry_silence_minutes,
            cancel_on_reply = true, cancel_on_resolved = true, cancel_on_opt_out = true } = request.body;

    const db = getAdminClient();

    // Validar que agent_id pertence à organização
    const { data: agent } = await db
      .from("agents")
      .select("id")
      .eq("id", agent_id)
      .eq("organization_id", orgId)
      .maybeSingle();
    if (!agent) return reply.status(403).send({ error: "Agente não pertence a esta organização" });

    // Validar que instance_id pertence à organização
    const { data: instance } = await db
      .from("evolution_instances")
      .select("id")
      .eq("id", instance_id)
      .eq("organization_id", orgId)
      .maybeSingle();
    if (!instance) return reply.status(403).send({ error: "Instância não pertence a esta organização" });

    const { data, error } = await db
      .from("remarketing_flows")
      .insert({ organization_id: orgId, name, product_campaign, agent_id, instance_id,
                entry_silence_minutes, cancel_on_reply, cancel_on_resolved, cancel_on_opt_out })
      .select()
      .single();

    if (error) return reply.status(500).send({ error: "Erro ao criar fluxo" });
    return reply.status(201).send(data);
  });

  // ── PUT /remarketing/flows/:id ─────────────────────────────────────────────
  app.put<{
    Params: { id: string };
    Body: {
      name?: string;
      product_campaign?: string;
      agent_id?: string;
      instance_id?: string;
      entry_silence_minutes?: number;
      cancel_on_reply?: boolean;
      cancel_on_resolved?: boolean;
      cancel_on_opt_out?: boolean;
    };
  }>("/remarketing/flows/:id", async (request, reply) => {
    const orgId = request.headers["x-organization-id"] as string;
    const membership = request.user.memberships.find(
      (m) => m.organization_id === orgId && m.role !== "agent"
    );
    if (!membership) return reply.status(403).send({ error: "Acesso de administrador necessário" });

    const db = getAdminClient();
    const { data: flow } = await db
      .from("remarketing_flows")
      .select("id")
      .eq("id", request.params.id)
      .eq("organization_id", orgId)
      .maybeSingle();
    if (!flow) return reply.status(404).send({ error: "Fluxo não encontrado" });

    const updates = request.body;

    if (updates.agent_id) {
      const { data: agent } = await db.from("agents").select("id")
        .eq("id", updates.agent_id).eq("organization_id", orgId).maybeSingle();
      if (!agent) return reply.status(403).send({ error: "Agente não pertence a esta organização" });
    }
    if (updates.instance_id) {
      const { data: instance } = await db.from("evolution_instances").select("id")
        .eq("id", updates.instance_id).eq("organization_id", orgId).maybeSingle();
      if (!instance) return reply.status(403).send({ error: "Instância não pertence a esta organização" });
    }

    const { data, error } = await db
      .from("remarketing_flows")
      .update(updates)
      .eq("id", request.params.id)
      .eq("organization_id", orgId)
      .select()
      .single();

    if (error) return reply.status(500).send({ error: "Erro ao atualizar fluxo" });
    return reply.send(data);
  });

  // ── DELETE /remarketing/flows/:id ─────────────────────────────────────────
  app.delete<{ Params: { id: string } }>("/remarketing/flows/:id", async (request, reply) => {
    const orgId = request.headers["x-organization-id"] as string;
    const membership = request.user.memberships.find(
      (m) => m.organization_id === orgId && m.role !== "agent"
    );
    if (!membership) return reply.status(403).send({ error: "Acesso de administrador necessário" });

    const db = getAdminClient();
    const { data: flow } = await db
      .from("remarketing_flows")
      .select("id")
      .eq("id", request.params.id)
      .eq("organization_id", orgId)
      .maybeSingle();
    if (!flow) return reply.status(404).send({ error: "Fluxo não encontrado" });

    // Bloquear se houver enrollments ativos
    const { count } = await db
      .from("remarketing_enrollments")
      .select("*", { count: "exact", head: true })
      .eq("flow_id", request.params.id)
      .eq("status", "active");

    if (count && count > 0) {
      return reply.status(409).send({
        error: "Existem conversas em andamento neste fluxo. Desative o fluxo primeiro para cancelar os enrollments ativos, depois exclua.",
      });
    }

    const { error } = await db
      .from("remarketing_flows")
      .delete()
      .eq("id", request.params.id)
      .eq("organization_id", orgId);

    if (error) return reply.status(500).send({ error: "Erro ao deletar fluxo" });
    return reply.status(204).send();
  });

  // ── POST /remarketing/flows/:id/duplicate ─────────────────────────────────
  app.post<{ Params: { id: string } }>(
    "/remarketing/flows/:id/duplicate",
    async (request, reply) => {
      const orgId = request.headers["x-organization-id"] as string;
      const membership = request.user.memberships.find(
        (m) => m.organization_id === orgId && m.role !== "agent"
      );
      if (!membership) return reply.status(403).send({ error: "Acesso de administrador necessário" });

      const db = getAdminClient();
      const { data: original } = await db
        .from("remarketing_flows")
        .select("*, remarketing_steps(*)")
        .eq("id", request.params.id)
        .eq("organization_id", orgId)
        .single();

      if (!original) return reply.status(404).send({ error: "Fluxo não encontrado" });

      const { id, created_at, updated_at, last_executed_at, remarketing_steps, ...flowData } = original;

      const { data: newFlow, error: flowErr } = await db
        .from("remarketing_flows")
        .insert({ ...flowData, name: `${flowData.name} (cópia)`, status: "inactive" })
        .select()
        .single();

      if (flowErr) return reply.status(500).send({ error: "Erro ao duplicar fluxo" });

      if (remarketing_steps && remarketing_steps.length > 0) {
        const steps = remarketing_steps.map(({ id: _id, flow_id: _fid, created_at: _ca, ...step }: Record<string, unknown>) => ({
          ...step,
          flow_id: newFlow.id,
        }));
        const { error: stepsErr } = await db.from("remarketing_steps").insert(steps);
        if (stepsErr) return reply.status(500).send({ error: "Erro ao duplicar etapas" });
      }

      return reply.status(201).send(newFlow);
    }
  );

  // ── PATCH /remarketing/flows/:id/status ───────────────────────────────────
  app.patch<{ Params: { id: string }; Body: { status: "active" | "inactive" } }>(
    "/remarketing/flows/:id/status",
    async (request, reply) => {
      const orgId = request.headers["x-organization-id"] as string;
      const membership = request.user.memberships.find(
        (m) => m.organization_id === orgId && m.role !== "agent"
      );
      if (!membership) return reply.status(403).send({ error: "Acesso de administrador necessário" });

      const { status } = request.body;
      if (!["active", "inactive"].includes(status)) {
        return reply.status(400).send({ error: "Status inválido" });
      }

      const db = getAdminClient();
      const { data: flow } = await db
        .from("remarketing_flows")
        .select("id")
        .eq("id", request.params.id)
        .eq("organization_id", orgId)
        .maybeSingle();
      if (!flow) return reply.status(404).send({ error: "Fluxo não encontrado" });

      // Ao desativar: cancelar enrollments ativos automaticamente
      if (status === "inactive") {
        await db
          .from("remarketing_enrollments")
          .update({ status: "cancelled", cancel_reason: "flow_deactivated" })
          .eq("flow_id", request.params.id)
          .eq("status", "active");
      }

      const { data, error } = await db
        .from("remarketing_flows")
        .update({ status })
        .eq("id", request.params.id)
        .eq("organization_id", orgId)
        .select()
        .single();

      if (error) return reply.status(500).send({ error: "Erro ao atualizar status" });
      return reply.send(data);
    }
  );
}
```

- [ ] **Step 2: Verificar tipos**

```bash
cd apps/api && pnpm build 2>&1 | grep remarketing
```

Resultado esperado: sem erros relacionados a remarketing.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/routes/remarketing/flows.ts
git commit -m "feat: rotas CRUD de fluxos de remarketing com role check e FK validation"
```

---

## Task 8: API — Rotas de Etapas

**Files:**
- Create: `apps/api/src/routes/remarketing/steps.ts`

- [ ] **Step 1: Criar o arquivo de rotas de etapas**

```typescript
// apps/api/src/routes/remarketing/steps.ts
import type { FastifyInstance } from "fastify";
import { getAdminClient } from "@aula-agente/database";
import { authMiddleware } from "../../middleware/auth";

async function resolveFlow(
  db: ReturnType<typeof getAdminClient>,
  flowId: string,
  orgId: string
) {
  const { data } = await db
    .from("remarketing_flows")
    .select("id")
    .eq("id", flowId)
    .eq("organization_id", orgId)
    .maybeSingle();
  return data;
}

async function resolveStep(
  db: ReturnType<typeof getAdminClient>,
  stepId: string,
  flowId: string
) {
  const { data } = await db
    .from("remarketing_steps")
    .select("id")
    .eq("id", stepId)
    .eq("flow_id", flowId)
    .maybeSingle();
  return data;
}

export default async function remarketingStepRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authMiddleware);

  // ── GET /remarketing/flows/:id/steps ──────────────────────────────────────
  app.get<{ Params: { id: string } }>(
    "/remarketing/flows/:id/steps",
    async (request, reply) => {
      const orgId = request.headers["x-organization-id"] as string;
      const membership = request.user.memberships.find((m) => m.organization_id === orgId);
      if (!membership) return reply.status(403).send({ error: "Acesso negado" });

      const db = getAdminClient();
      const flow = await resolveFlow(db, request.params.id, orgId);
      if (!flow) return reply.status(404).send({ error: "Fluxo não encontrado" });

      const { data, error } = await db
        .from("remarketing_steps")
        .select("*")
        .eq("flow_id", request.params.id)
        .order("step_order", { ascending: true });

      if (error) return reply.status(500).send({ error: "Erro ao listar etapas" });
      return reply.send(data);
    }
  );

  // ── POST /remarketing/flows/:id/steps ─────────────────────────────────────
  app.post<{
    Params: { id: string };
    Body: { step_order: number; wait_minutes: number; message_type: string; message_content: string };
  }>("/remarketing/flows/:id/steps", async (request, reply) => {
    const orgId = request.headers["x-organization-id"] as string;
    const membership = request.user.memberships.find(
      (m) => m.organization_id === orgId && m.role !== "agent"
    );
    if (!membership) return reply.status(403).send({ error: "Acesso de administrador necessário" });

    const db = getAdminClient();
    const flow = await resolveFlow(db, request.params.id, orgId);
    if (!flow) return reply.status(404).send({ error: "Fluxo não encontrado" });

    const { data, error } = await db
      .from("remarketing_steps")
      .insert({ flow_id: request.params.id, ...request.body })
      .select()
      .single();

    if (error) return reply.status(500).send({ error: "Erro ao criar etapa" });
    return reply.status(201).send(data);
  });

  // ── PUT /remarketing/flows/:id/steps/:stepId ──────────────────────────────
  app.put<{
    Params: { id: string; stepId: string };
    Body: { step_order?: number; wait_minutes?: number; message_type?: string; message_content?: string; is_active?: boolean };
  }>("/remarketing/flows/:id/steps/:stepId", async (request, reply) => {
    const orgId = request.headers["x-organization-id"] as string;
    const membership = request.user.memberships.find(
      (m) => m.organization_id === orgId && m.role !== "agent"
    );
    if (!membership) return reply.status(403).send({ error: "Acesso de administrador necessário" });

    const db = getAdminClient();
    const flow = await resolveFlow(db, request.params.id, orgId);
    if (!flow) return reply.status(404).send({ error: "Fluxo não encontrado" });

    // Validar que stepId pertence ao flow (previne IDOR)
    const step = await resolveStep(db, request.params.stepId, request.params.id);
    if (!step) return reply.status(404).send({ error: "Etapa não encontrada" });

    const { data, error } = await db
      .from("remarketing_steps")
      .update(request.body)
      .eq("id", request.params.stepId)
      .eq("flow_id", request.params.id)
      .select()
      .single();

    if (error) return reply.status(500).send({ error: "Erro ao atualizar etapa" });
    return reply.send(data);
  });

  // ── DELETE /remarketing/flows/:id/steps/:stepId ───────────────────────────
  app.delete<{ Params: { id: string; stepId: string } }>(
    "/remarketing/flows/:id/steps/:stepId",
    async (request, reply) => {
      const orgId = request.headers["x-organization-id"] as string;
      const membership = request.user.memberships.find(
        (m) => m.organization_id === orgId && m.role !== "agent"
      );
      if (!membership) return reply.status(403).send({ error: "Acesso de administrador necessário" });

      const db = getAdminClient();
      const flow = await resolveFlow(db, request.params.id, orgId);
      if (!flow) return reply.status(404).send({ error: "Fluxo não encontrado" });

      const step = await resolveStep(db, request.params.stepId, request.params.id);
      if (!step) return reply.status(404).send({ error: "Etapa não encontrada" });

      const { error } = await db
        .from("remarketing_steps")
        .delete()
        .eq("id", request.params.stepId)
        .eq("flow_id", request.params.id);

      if (error) return reply.status(500).send({ error: "Erro ao deletar etapa" });
      return reply.status(204).send();
    }
  );

  // ── PATCH /remarketing/flows/:id/steps/:stepId/status ─────────────────────
  app.patch<{ Params: { id: string; stepId: string }; Body: { is_active: boolean } }>(
    "/remarketing/flows/:id/steps/:stepId/status",
    async (request, reply) => {
      const orgId = request.headers["x-organization-id"] as string;
      const membership = request.user.memberships.find(
        (m) => m.organization_id === orgId && m.role !== "agent"
      );
      if (!membership) return reply.status(403).send({ error: "Acesso de administrador necessário" });

      const db = getAdminClient();
      const flow = await resolveFlow(db, request.params.id, orgId);
      if (!flow) return reply.status(404).send({ error: "Fluxo não encontrado" });

      const step = await resolveStep(db, request.params.stepId, request.params.id);
      if (!step) return reply.status(404).send({ error: "Etapa não encontrada" });

      const { data, error } = await db
        .from("remarketing_steps")
        .update({ is_active: request.body.is_active })
        .eq("id", request.params.stepId)
        .eq("flow_id", request.params.id)
        .select()
        .single();

      if (error) return reply.status(500).send({ error: "Erro ao atualizar etapa" });
      return reply.send(data);
    }
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/routes/remarketing/steps.ts
git commit -m "feat: rotas de etapas com validação de ownership (previne IDOR)"
```

---

## Task 9: Registrar Rotas na API

**Files:**
- Create: `apps/api/src/routes/remarketing/index.ts`
- Modify: `apps/api/src/server.ts`

- [ ] **Step 1: Criar o index do módulo**

```typescript
// apps/api/src/routes/remarketing/index.ts
import type { FastifyInstance } from "fastify";
import remarketingFlowRoutes from "./flows";
import remarketingStepRoutes from "./steps";

export default async function remarketingRoutes(app: FastifyInstance) {
  app.register(remarketingFlowRoutes);
  app.register(remarketingStepRoutes);
}
```

- [ ] **Step 2: Registrar em server.ts**

Abra `apps/api/src/server.ts`. Adicione o import junto aos outros:

```typescript
import remarketingRoutes from "./routes/remarketing/index";
```

Adicione o register junto aos outros `server.register(...)`:

```typescript
server.register(remarketingRoutes);
```

- [ ] **Step 3: Build da API**

```bash
cd apps/api && pnpm build
```

Resultado esperado: sem erros.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/remarketing/index.ts apps/api/src/server.ts
git commit -m "feat: registrar rotas de remarketing na API"
```

---

## Task 10: Frontend — Navegação

**Files:**
- Modify: `apps/web/src/components/layout/app-sidebar.tsx`

- [ ] **Step 1: Adicionar Remarketing à navegação**

Abra `apps/web/src/components/layout/app-sidebar.tsx`.

Adicione `RefreshCw` ao import do lucide-react:

```typescript
import { Inbox, Bot, Radio, Users, Settings, Zap, LogOut, RefreshCw } from "lucide-react";
```

Edite o array `navigation` para incluir Remarketing entre Agentes e Configurações:

```typescript
const navigation = [
  { name: "Inbox", href: "/inbox", icon: Inbox },
  { name: "Agentes", href: "/agents", icon: Bot },
  { name: "Instâncias", href: "/instances", icon: Radio },
  { name: "Remarketing", href: "/remarketing", icon: RefreshCw },
  { name: "Equipe", href: "/team", icon: Users },
  { name: "Configurações", href: "/settings", icon: Settings },
];
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/layout/app-sidebar.tsx
git commit -m "feat: adicionar Remarketing ao menu lateral"
```

---

## Task 11: Frontend — Página de Listagem

**Files:**
- Create: `apps/web/src/app/(dashboard)/remarketing/page.tsx`
- Create: `apps/web/src/components/remarketing/flow-list.tsx`

- [ ] **Step 1: Criar o componente de lista**

```tsx
// apps/web/src/components/remarketing/flow-list.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Edit, Copy, Trash2, ToggleLeft, ToggleRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RemarketingFlow } from "@aula-agente/shared";

interface FlowListProps {
  flows: (RemarketingFlow & { step_count?: number })[];
  onRefresh: () => void;
  apiUrl: string;
  orgId: string;
}

export function FlowList({ flows, onRefresh, apiUrl, orgId }: FlowListProps) {
  const router = useRouter();
  const [loadingId, setLoadingId] = useState<string | null>(null);

  async function getAuthHeaders() {
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session?.access_token}`,
      "x-organization-id": orgId,
    };
  }

  async function handleToggleStatus(flow: RemarketingFlow) {
    setLoadingId(flow.id);
    const headers = await getAuthHeaders();
    const newStatus = flow.status === "active" ? "inactive" : "active";
    await fetch(`${apiUrl}/remarketing/flows/${flow.id}/status`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ status: newStatus }),
    });
    onRefresh();
    setLoadingId(null);
  }

  async function handleDuplicate(flow: RemarketingFlow) {
    setLoadingId(flow.id);
    const headers = await getAuthHeaders();
    await fetch(`${apiUrl}/remarketing/flows/${flow.id}/duplicate`, {
      method: "POST",
      headers,
    });
    onRefresh();
    setLoadingId(null);
  }

  async function handleDelete(flow: RemarketingFlow) {
    if (!confirm(`Excluir "${flow.name}"? Esta ação não pode ser desfeita.`)) return;
    setLoadingId(flow.id);
    const headers = await getAuthHeaders();
    const res = await fetch(`${apiUrl}/remarketing/flows/${flow.id}`, {
      method: "DELETE",
      headers,
    });
    if (res.status === 409) {
      const body = await res.json();
      alert(body.error);
    }
    onRefresh();
    setLoadingId(null);
  }

  if (flows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border py-16 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted">
          <span className="text-2xl">📣</span>
        </div>
        <div>
          <h3 className="font-semibold text-foreground">Nenhum fluxo de remarketing</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Crie seu primeiro fluxo para começar a recuperar clientes
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40">
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">Nome</th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">Produto</th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">Etapas</th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">Última execução</th>
            <th className="px-4 py-3 text-right font-medium text-muted-foreground">Ações</th>
          </tr>
        </thead>
        <tbody>
          {flows.map((flow) => (
            <tr key={flow.id} className="border-b border-border last:border-0 hover:bg-muted/20">
              <td className="px-4 py-3 font-medium text-foreground">{flow.name}</td>
              <td className="px-4 py-3 text-muted-foreground">{flow.product_campaign || "—"}</td>
              <td className="px-4 py-3 text-muted-foreground">{flow.step_count ?? 0}</td>
              <td className="px-4 py-3">
                <span
                  className={cn(
                    "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                    flow.status === "active"
                      ? "bg-green-500/10 text-green-400"
                      : "bg-muted text-muted-foreground"
                  )}
                >
                  {flow.status === "active" ? "Ativo" : "Inativo"}
                </span>
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                {flow.last_executed_at
                  ? new Date(flow.last_executed_at).toLocaleString("pt-BR")
                  : "Nunca"}
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center justify-end gap-2">
                  <button
                    onClick={() => router.push(`/remarketing/${flow.id}/edit`)}
                    className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-accent"
                    title="Editar"
                  >
                    <Edit className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => handleDuplicate(flow)}
                    disabled={loadingId === flow.id}
                    className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-accent"
                    title="Duplicar"
                  >
                    <Copy className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => handleToggleStatus(flow)}
                    disabled={loadingId === flow.id}
                    className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-accent"
                    title={flow.status === "active" ? "Desativar" : "Ativar"}
                  >
                    {flow.status === "active"
                      ? <ToggleRight className="h-4 w-4 text-green-400" />
                      : <ToggleLeft className="h-4 w-4" />}
                  </button>
                  <button
                    onClick={() => handleDelete(flow)}
                    disabled={loadingId === flow.id}
                    className="rounded p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                    title="Excluir"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Criar a página de listagem**

```tsx
// apps/web/src/app/(dashboard)/remarketing/page.tsx
"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useOrganization } from "@/providers/organization-provider";
import { createClient } from "@/lib/supabase/client";
import { FlowList } from "@/components/remarketing/flow-list";
import { Plus, RefreshCw } from "lucide-react";
import type { RemarketingFlow } from "@aula-agente/shared";

const API_URL = process.env.NEXT_PUBLIC_API_URL!;

type FlowWithCount = RemarketingFlow & { step_count?: number };

export default function RemarketingPage() {
  const { currentOrg, loading: orgLoading } = useOrganization();
  const [flows, setFlows] = useState<FlowWithCount[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchFlows = useCallback(async () => {
    if (!currentOrg) return;
    setLoading(true);
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`${API_URL}/remarketing/flows`, {
      headers: {
        Authorization: `Bearer ${session?.access_token}`,
        "x-organization-id": currentOrg.id,
      },
    });
    if (res.ok) {
      const data = await res.json();
      // Calcular contagem de etapas a partir do select com count
      const withCount = data.map((f: RemarketingFlow & { remarketing_steps?: { count: number }[] }) => ({
        ...f,
        step_count: f.remarketing_steps?.[0]?.count ?? 0,
      }));
      setFlows(withCount);
    }
    setLoading(false);
  }, [currentOrg]);

  useEffect(() => {
    fetchFlows();
  }, [fetchFlows]);

  if (orgLoading || loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="h-7 w-32 animate-pulse rounded-lg bg-muted" />
          <div className="h-9 w-48 animate-pulse rounded-lg bg-muted" />
        </div>
        <div className="h-48 animate-pulse rounded-xl bg-muted" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Remarketing</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {flows.length} {flows.length === 1 ? "fluxo configurado" : "fluxos configurados"}
          </p>
        </div>
        <Link href="/remarketing/new/edit">
          <button className="flex items-center gap-2 rounded-lg bg-amber-fire-500 px-4 py-2 text-sm font-semibold text-[#0F1219] transition-colors hover:bg-amber-fire-400">
            <Plus className="h-4 w-4" />
            Novo fluxo de remarketing
          </button>
        </Link>
      </div>

      <FlowList
        flows={flows}
        onRefresh={fetchFlows}
        apiUrl={API_URL}
        orgId={currentOrg?.id ?? ""}
      />
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/"(dashboard)"/remarketing/page.tsx apps/web/src/components/remarketing/flow-list.tsx
git commit -m "feat: página de listagem de fluxos de remarketing"
```

---

## Task 12: Frontend — Página de Edição

**Files:**
- Create: `apps/web/src/components/remarketing/flow-form.tsx`
- Create: `apps/web/src/components/remarketing/steps-editor.tsx`
- Create: `apps/web/src/app/(dashboard)/remarketing/[flowId]/edit/page.tsx`

- [ ] **Step 1: Criar o formulário de configurações do fluxo**

```tsx
// apps/web/src/components/remarketing/flow-form.tsx
"use client";

import type { RemarketingFlow } from "@aula-agente/shared";

interface Agent { id: string; name: string }
interface Instance { id: string; name: string }

interface FlowFormProps {
  data: Partial<RemarketingFlow>;
  agents: Agent[];
  instances: Instance[];
  onChange: (updates: Partial<RemarketingFlow>) => void;
}

export function FlowForm({ data, agents, instances, onChange }: FlowFormProps) {
  return (
    <div className="space-y-5">
      <div>
        <label className="block text-xs font-medium text-muted-foreground mb-1.5">Nome do fluxo</label>
        <input
          value={data.name ?? ""}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="Ex: Remarketing Vector Black"
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-blue-electric-400"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-muted-foreground mb-1.5">Produto / Campanha</label>
        <input
          value={data.product_campaign ?? ""}
          onChange={(e) => onChange({ product_campaign: e.target.value })}
          placeholder="Ex: Vector Black"
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-blue-electric-400"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-muted-foreground mb-1.5">Agente de retorno</label>
        <select
          value={data.agent_id ?? ""}
          onChange={(e) => onChange({ agent_id: e.target.value })}
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-blue-electric-400"
        >
          <option value="">Selecione um agente</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs font-medium text-muted-foreground mb-1.5">Instância (WhatsApp)</label>
        <select
          value={data.instance_id ?? ""}
          onChange={(e) => onChange({ instance_id: e.target.value })}
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-blue-electric-400"
        >
          <option value="">Selecione uma instância</option>
          {instances.map((i) => (
            <option key={i.id} value={i.id}>{i.name}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs font-medium text-muted-foreground mb-1.5">
          Critério de entrada (minutos sem resposta do cliente)
        </label>
        <input
          type="number"
          min={1}
          value={data.entry_silence_minutes ?? 15}
          onChange={(e) => onChange({ entry_silence_minutes: parseInt(e.target.value) || 15 })}
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-blue-electric-400"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-muted-foreground mb-2">Cancelar quando</label>
        <div className="space-y-2">
          {[
            { key: "cancel_on_reply" as const, label: "Cliente responder" },
            { key: "cancel_on_resolved" as const, label: "Atendimento finalizar" },
            { key: "cancel_on_opt_out" as const, label: "Cliente pedir para parar" },
          ].map(({ key, label }) => (
            <label key={key} className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={data[key] ?? true}
                onChange={(e) => onChange({ [key]: e.target.checked })}
                className="h-4 w-4 rounded border-border"
              />
              <span className="text-sm text-foreground">{label}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between pt-2 border-t border-border">
        <span className="text-sm text-muted-foreground">Status</span>
        <button
          type="button"
          onClick={() => onChange({ status: data.status === "active" ? "inactive" : "active" })}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
            data.status === "active" ? "bg-blue-electric-400" : "bg-muted"
          }`}
        >
          <span
            className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
              data.status === "active" ? "translate-x-4.5" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Criar o editor de etapas**

```tsx
// apps/web/src/components/remarketing/steps-editor.tsx
"use client";

import { Trash2 } from "lucide-react";
import type { RemarketingStep } from "@aula-agente/shared";

type StepDraft = Omit<RemarketingStep, "id" | "flow_id" | "created_at"> & { _tempId?: string };

interface StepsEditorProps {
  steps: StepDraft[];
  onChange: (steps: StepDraft[]) => void;
}

export function StepsEditor({ steps, onChange }: StepsEditorProps) {
  function addStep() {
    const maxOrder = steps.reduce((max, s) => Math.max(max, s.step_order), 0);
    onChange([
      ...steps,
      {
        _tempId: crypto.randomUUID(),
        step_order: maxOrder + 1,
        wait_minutes: 60,
        message_type: "text",
        message_content: "",
        is_active: true,
      },
    ]);
  }

  function removeStep(index: number) {
    onChange(steps.filter((_, i) => i !== index));
  }

  function updateStep(index: number, updates: Partial<StepDraft>) {
    onChange(steps.map((s, i) => (i === index ? { ...s, ...updates } : s)));
  }

  return (
    <div className="space-y-4">
      {steps.map((step, index) => (
        <div key={step._tempId ?? step.step_order} className="rounded-lg border border-border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-blue-electric-400">Etapa {index + 1}</span>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={step.is_active}
                  onChange={(e) => updateStep(index, { is_active: e.target.checked })}
                  className="h-3.5 w-3.5"
                />
                Ativa
              </label>
              <button
                onClick={() => removeStep(index)}
                className="rounded p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Aguardar (minutos)</label>
              <input
                type="number"
                min={0}
                value={step.wait_minutes}
                onChange={(e) => updateStep(index, { wait_minutes: parseInt(e.target.value) || 0 })}
                className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-blue-electric-400"
              />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Tipo</label>
              <select
                value={step.message_type}
                onChange={(e) => updateStep(index, { message_type: e.target.value as "text" | "audio" | "image" })}
                className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-blue-electric-400"
              >
                <option value="text">Texto</option>
                <option value="audio">Áudio</option>
                <option value="image">Imagem</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs text-muted-foreground mb-1">
              {step.message_type === "text" ? "Mensagem" : "URL do arquivo"}
            </label>
            {step.message_type === "text" ? (
              <textarea
                rows={3}
                value={step.message_content}
                onChange={(e) => updateStep(index, { message_content: e.target.value })}
                placeholder="Digite a mensagem..."
                className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-blue-electric-400 resize-none"
              />
            ) : (
              <input
                value={step.message_content}
                onChange={(e) => updateStep(index, { message_content: e.target.value })}
                placeholder="https://..."
                className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-blue-electric-400"
              />
            )}
          </div>
        </div>
      ))}

      <button
        onClick={addStep}
        className="w-full rounded-lg border-2 border-dashed border-border py-3 text-sm font-medium text-muted-foreground hover:border-blue-electric-400/40 hover:text-blue-electric-400 transition-colors"
      >
        + Adicionar etapa
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Criar a página de edição**

```tsx
// apps/web/src/app/(dashboard)/remarketing/[flowId]/edit/page.tsx
"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useOrganization } from "@/providers/organization-provider";
import { createClient } from "@/lib/supabase/client";
import { FlowForm } from "@/components/remarketing/flow-form";
import { StepsEditor } from "@/components/remarketing/steps-editor";
import { Loader2 } from "lucide-react";
import type { RemarketingFlow, RemarketingStep } from "@aula-agente/shared";

const API_URL = process.env.NEXT_PUBLIC_API_URL!;

type StepDraft = Omit<RemarketingStep, "id" | "flow_id" | "created_at"> & { _tempId?: string; id?: string };

const DEFAULT_FLOW: Partial<RemarketingFlow> = {
  name: "",
  product_campaign: "",
  status: "inactive",
  entry_silence_minutes: 15,
  cancel_on_reply: true,
  cancel_on_resolved: true,
  cancel_on_opt_out: true,
};

export default function FlowEditPage() {
  const params = useParams<{ flowId: string }>();
  const router = useRouter();
  const { currentOrg } = useOrganization();
  const isNew = params.flowId === "new";

  const [flowData, setFlowData] = useState<Partial<RemarketingFlow>>(DEFAULT_FLOW);
  const [steps, setSteps] = useState<StepDraft[]>([]);
  const [agents, setAgents] = useState<{ id: string; name: string }[]>([]);
  const [instances, setInstances] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);

  const getHeaders = useCallback(async () => {
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session?.access_token}`,
      "x-organization-id": currentOrg?.id ?? "",
    };
  }, [currentOrg]);

  useEffect(() => {
    if (!currentOrg) return;
    const supabase = createClient();

    Promise.all([
      supabase.from("agents").select("id, name").eq("organization_id", currentOrg.id),
      supabase.from("evolution_instances").select("id, name").eq("organization_id", currentOrg.id),
    ]).then(([{ data: ag }, { data: inst }]) => {
      setAgents(ag ?? []);
      setInstances(inst ?? []);
    });

    if (!isNew) {
      getHeaders().then(async (headers) => {
        const [flowRes, stepsRes] = await Promise.all([
          fetch(`${API_URL}/remarketing/flows`, { headers }),
          fetch(`${API_URL}/remarketing/flows/${params.flowId}/steps`, { headers }),
        ]);
        if (flowRes.ok) {
          const allFlows: RemarketingFlow[] = await flowRes.json();
          const flow = allFlows.find((f) => f.id === params.flowId);
          if (flow) setFlowData(flow);
        }
        if (stepsRes.ok) {
          const data: RemarketingStep[] = await stepsRes.json();
          setSteps(data.map((s) => ({ ...s, _tempId: s.id })));
        }
        setLoading(false);
      });
    }
  }, [currentOrg, isNew, params.flowId, getHeaders]);

  async function handleSave() {
    if (!currentOrg) return;
    setSaving(true);
    const headers = await getHeaders();

    try {
      let flowId = params.flowId;

      if (isNew) {
        const res = await fetch(`${API_URL}/remarketing/flows`, {
          method: "POST",
          headers,
          body: JSON.stringify(flowData),
        });
        if (!res.ok) throw new Error(await res.text());
        const created = await res.json();
        flowId = created.id;
      } else {
        const res = await fetch(`${API_URL}/remarketing/flows/${flowId}`, {
          method: "PUT",
          headers,
          body: JSON.stringify(flowData),
        });
        if (!res.ok) throw new Error(await res.text());
      }

      // Salvar etapas: atualizar existentes, criar novas, deletar removidas
      const currentStepIds = new Set(steps.filter((s) => s.id).map((s) => s.id!));

      // Buscar IDs das etapas que existem no banco para este fluxo
      const existingRes = await fetch(`${API_URL}/remarketing/flows/${flowId}/steps`, { headers });
      if (existingRes.ok) {
        const dbSteps: { id: string }[] = await existingRes.json();
        // Deletar etapas que foram removidas no editor
        for (const dbStep of dbSteps) {
          if (!currentStepIds.has(dbStep.id)) {
            await fetch(`${API_URL}/remarketing/flows/${flowId}/steps/${dbStep.id}`, {
              method: "DELETE",
              headers,
            });
          }
        }
      }

      for (const step of steps) {
        const { _tempId, id, ...body } = step;
        if (id) {
          // Atualizar etapa existente
          await fetch(`${API_URL}/remarketing/flows/${flowId}/steps/${id}`, {
            method: "PUT",
            headers,
            body: JSON.stringify(body),
          });
        } else {
          // Criar nova etapa
          await fetch(`${API_URL}/remarketing/flows/${flowId}/steps`, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
          });
        }
      }

      router.push("/remarketing");
    } catch (err) {
      console.error("Erro ao salvar:", err);
      alert("Erro ao salvar o fluxo. Verifique os campos e tente novamente.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-foreground">
          {isNew ? "Novo fluxo de remarketing" : "Editar fluxo"}
        </h1>
        <div className="flex gap-2">
          <button
            onClick={() => router.push("/remarketing")}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-accent"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 rounded-lg bg-amber-fire-500 px-4 py-2 text-sm font-semibold text-[#0F1219] hover:bg-amber-fire-400 disabled:opacity-60"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Salvar
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Coluna esquerda — configurações */}
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold text-foreground mb-4">Configurações do fluxo</h2>
          <FlowForm
            data={flowData}
            agents={agents}
            instances={instances}
            onChange={(updates) => setFlowData((prev) => ({ ...prev, ...updates }))}
          />
        </div>

        {/* Coluna direita — etapas */}
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold text-foreground mb-4">Etapas</h2>
          <StepsEditor steps={steps} onChange={setSteps} />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/remarketing/ apps/web/src/app/"(dashboard)"/remarketing/
git commit -m "feat: página de edição de fluxo de remarketing com form e editor de etapas"
```

---

## Verificação Final

- [ ] **Build completo do monorepo**

```bash
cd C:/Users/PC/desktop/agentes && pnpm build
```

Resultado esperado: todos os pacotes e apps compilam sem erros.

- [ ] **Smoke test manual**
  1. Abrir a aplicação web
  2. Verificar que "Remarketing" aparece no menu lateral
  3. Acessar `/remarketing` — tela vazia com botão de novo fluxo
  4. Criar um fluxo com 3 etapas
  5. Verificar que aparece na listagem com status "Inativo"
  6. Ativar o fluxo
  7. Verificar que o DELETE com fluxo ativo retorna o erro 409

- [ ] **Commit final**

```bash
git add -A
git commit -m "feat: módulo de Remarketing completo (DB + Worker + API + Frontend)"
```
