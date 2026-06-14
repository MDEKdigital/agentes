# Remarketing Module — Design Spec

**Date:** 2026-06-14  
**Status:** Approved (rev 2 — post code review)

---

## Overview

Nova área "Remarketing" no painel de controle, separada dos agentes de atendimento. Permite criar fluxos automáticos de recuperação para clientes que pararam de responder. Cada organização tem seus próprios fluxos (multi-tenant, isolado por `organization_id`).

Não é um CRM. É uma ferramenta simples de automação de mensagens vinculada a agentes de IA.

---

## Banco de Dados

### `remarketing_flows`

Fluxos configurados por organização.

| Coluna | Tipo | Descrição |
|---|---|---|
| `id` | uuid PK | |
| `organization_id` | uuid FK | Isolamento multi-tenant |
| `name` | text | Ex: "Remarketing Vector Black" |
| `product_campaign` | text | Ex: "Vector Black" |
| `agent_id` | uuid FK → agents | Agente de IA para retorno quando cliente responder. Deve pertencer à mesma `organization_id`. |
| `instance_id` | uuid FK → evolution_instances | Filtro: só conversas dessa instância. Deve pertencer à mesma `organization_id`. |
| `status` | enum (active, inactive) | |
| `entry_silence_minutes` | integer | Minutos sem mensagem do cliente para entrar no fluxo |
| `cancel_on_reply` | boolean default true | Cancelar quando cliente responder |
| `cancel_on_resolved` | boolean default true | Cancelar quando atendimento finalizar |
| `cancel_on_opt_out` | boolean default true | Cancelar quando mensagem do cliente contiver palavra-chave de opt-out (ver lista em Regras obrigatórias) |
| `last_executed_at` | timestamptz nullable | Última vez que uma etapa foi enviada em qualquer enrollment deste fluxo. Fonte da coluna "Última execução" na UI. |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

> **Removido:** `cancel_on_purchase` — não existe tabela de compras nem mecanismo de detecção de conversão no sistema atual. Pode ser adicionado futuramente junto com integração de e-commerce.

### `remarketing_steps`

Etapas de cada fluxo, em ordem.

| Coluna | Tipo | Descrição |
|---|---|---|
| `id` | uuid PK | |
| `flow_id` | uuid FK → remarketing_flows | |
| `step_order` | integer | Ordem de exibição (1, 2, 3…). Usado apenas para ordenação na UI, nunca como ponteiro de estado. |
| `wait_minutes` | integer | Tempo de espera desde a etapa anterior (ou desde `enrolled_at` para etapa 1) |
| `message_type` | enum (text, audio, image) | |
| `message_content` | text | Texto ou URL do arquivo |
| `is_active` | boolean default true | Pode desativar etapa individual |
| `created_at` | timestamptz | |

### `remarketing_enrollments`

Rastreia conversas atualmente em remarketing ativo.

| Coluna | Tipo | Descrição |
|---|---|---|
| `id` | uuid PK | |
| `flow_id` | uuid FK → remarketing_flows | |
| `conversation_id` | uuid FK → conversations | |
| `organization_id` | uuid FK | |
| `next_step_id` | uuid nullable FK → remarketing_steps | ID da próxima etapa a enviar. NULL indica que não há mais etapas (enrollment completo). Usar UUID evita corrupção silenciosa ao reordenar etapas. |
| `enrolled_at` | timestamptz | Quando entrou no fluxo |
| `last_step_sent_at` | timestamptz nullable | Quando a última etapa foi enviada |
| `status` | enum (active, completed, cancelled) | |
| `cancel_reason` | text nullable | Ex: "reply", "resolved", "opt_out" |
| `created_at` | timestamptz | |

**Constraint obrigatória:** `UNIQUE (conversation_id) WHERE status = 'active'` — partial unique index garantido pelo banco, não apenas pela aplicação.

---

## Motor de Remarketing (Worker)

### Abordagem: Polling Worker

Novo worker `remarketing-worker.ts` em `apps/worker/src/workers/`, seguindo o padrão do `takeover-timeout`. Roda a cada minuto via BullMQ scheduler com **`concurrency: 1`** para evitar execuções paralelas que violem o invariante de enrollment único.

### Critério de silêncio

O worker detecta silêncio consultando a tabela `messages`: a conversa está silenciosa se não existe nenhuma mensagem com `role = 'contact'` nos últimos `entry_silence_minutes` minutos — ou seja:

```sql
NOT EXISTS (
  SELECT 1 FROM messages
  WHERE conversation_id = c.id
    AND role = 'contact'
    AND created_at > now() - (entry_silence_minutes || ' minutes')::interval
)
```

**Nunca usar `conversations.updated_at`** como proxy de silêncio — esse campo é atualizado por qualquer evento interno (mudança de status, human takeover, atribuição de agente), o que faria conversas silenciosas do ponto de vista do cliente nunca entrarem no remarketing.

### Ciclo de execução

**Passo 1 — Detectar novas entradas:**
- Busca conversas com status `open` ou `waiting`, cujo `agent_id` corresponde a um fluxo ativo e cuja `instance_id` corresponde ao filtro do fluxo.
- Filtra pelo critério de silêncio acima (sem mensagem com `role = 'contact'` nos últimos `entry_silence_minutes`).
- Exclui conversas que já têm enrollment `active` (garantido também pelo partial unique index).
- Para cada conversa elegível: cria um `remarketing_enrollment` com `next_step_id` = ID da primeira etapa ativa do fluxo (menor `step_order` com `is_active = true`) e `status = active`.

**Passo 2 — Processar etapas pendentes:**
- Busca todos os enrollments `active` onde `next_step_id IS NOT NULL`.
- Para cada enrollment, carrega a etapa referenciada por `next_step_id`.
- Verifica o timer: `last_step_sent_at + wait_minutes <= agora` (ou `enrolled_at + wait_minutes` se `last_step_sent_at IS NULL`).
- **Antes de enviar**, verifica regras de cancelamento (ver abaixo). Se cancelar, marca enrollment como `cancelled` e para.
- Envia mensagem via fila `send-message` existente.
- Atualiza `last_step_sent_at = now()` e `next_step_id` = ID da próxima etapa ativa (próximo `step_order` com `is_active = true`). Se não houver próxima etapa ativa, `next_step_id = NULL` e `status = completed`.
- Atualiza `remarketing_flows.last_executed_at = now()`.

### Fila

Nova entrada `REMARKETING` em `packages/shared/src/constants.ts` → `QUEUE_NAMES`.  
Nova função `getRemarketing Queue()` corrigida para `getRemarketing Queue()` → **`getRemarketingQueue()`** em `packages/queue/src/queues.ts`, seguindo o padrão singleton existente.

### Regras obrigatórias

- **Nunca enviar duas etapas ao mesmo tempo:** `concurrency: 1` no worker previne execuções paralelas. O partial unique index em `(conversation_id) WHERE status = 'active'` garante isso no nível do banco.
- **Nunca repetir etapa:** `next_step_id` avança para a próxima etapa após cada envio e nunca retrocede.
- **cancel_on_reply:** verificar se existe mensagem com `role = 'contact'` na tabela `messages` com `created_at > enrolled_at`. Se sim, cancelar enrollment e atualizar `conversations.agent_id` para o `agent_id` do fluxo, devolvendo a conversa para atendimento de IA.
- **cancel_on_resolved:** verificar se `conversations.status` é `resolved` ou `closed`.
- **cancel_on_opt_out:** verificar se a mensagem mais recente do contato (`role = 'contact'`) contém alguma das palavras-chave: `["pare", "parar", "stop", "cancelar", "não quero", "chega", "sair"]`. A comparação é case-insensitive.
- **Registrar mensagens:** todas as mensagens enviadas pelo remarketing são inseridas na tabela `messages` com `role = 'agent'`, vinculadas à `conversation_id`.

### Índices necessários

Criar os seguintes índices para suportar as queries do worker sem sequential scan:

```sql
-- Critério de silêncio (Passo 1)
CREATE INDEX idx_messages_conversation_role_created
  ON messages (conversation_id, role, created_at);

-- Enrollments ativos (Passo 2)
CREATE INDEX idx_remarketing_enrollments_active
  ON remarketing_enrollments (status, next_step_id)
  WHERE status = 'active';

-- Unique constraint de enrollment
CREATE UNIQUE INDEX idx_remarketing_enrollments_unique_active
  ON remarketing_enrollments (conversation_id)
  WHERE status = 'active';
```

---

## API (Backend)

Novas rotas em `apps/api/src/routes/remarketing/`. Todas exigem:
1. Autenticação e `organization_id` via middleware existente (`requireAuth` + `requireOrg`)
2. **Rotas de escrita (POST, PUT, PATCH, DELETE): verificar `role !== 'agent'`** — seguir o mesmo padrão de `knowledge/faqs.ts`, `knowledge/documents.ts` e `instances/index.ts`

### Validação de FKs

Nas rotas de criação e edição de fluxos (`POST /flows`, `PUT /flows/:id`): validar que `agent_id` e `instance_id` pertencem à mesma `organization_id` do usuário antes de persistir. Retornar `403` se não pertencerem.

Nas rotas de steps (`PUT /flows/:id/steps/:stepId`, `DELETE /flows/:id/steps/:stepId`, `PATCH /flows/:id/steps/:stepId/status`): validar que o `stepId` pertence ao `flow_id` informado antes de executar qualquer operação. Retornar `404` se não pertencer (evita IDOR).

### Fluxos

| Método | Rota | Ação |
|---|---|---|
| GET | `/remarketing/flows` | Lista fluxos da organização |
| POST | `/remarketing/flows` | Cria fluxo (role ≠ agent) |
| PUT | `/remarketing/flows/:id` | Edita fluxo (role ≠ agent) |
| DELETE | `/remarketing/flows/:id` | Remove fluxo — ver regra abaixo (role ≠ agent) |
| POST | `/remarketing/flows/:id/duplicate` | Duplica fluxo com todas as etapas (role ≠ agent) |
| PATCH | `/remarketing/flows/:id/status` | Ativa ou desativa fluxo (role ≠ agent) |

**Regra de DELETE:** se o fluxo possui enrollments com `status = 'active'`, retornar `409 Conflict` com mensagem "Existem conversas em andamento neste fluxo. Desative o fluxo primeiro para cancelar os enrollments ativos, depois exclua." Não fazer hard delete silencioso de conversas em andamento.

### Etapas

| Método | Rota | Ação |
|---|---|---|
| GET | `/remarketing/flows/:id/steps` | Lista etapas do fluxo |
| POST | `/remarketing/flows/:id/steps` | Adiciona etapa (role ≠ agent) |
| PUT | `/remarketing/flows/:id/steps/:stepId` | Edita etapa — valida stepId pertence ao flow (role ≠ agent) |
| DELETE | `/remarketing/flows/:id/steps/:stepId` | Remove etapa — valida stepId pertence ao flow (role ≠ agent) |
| PATCH | `/remarketing/flows/:id/steps/:stepId/status` | Ativa/desativa etapa — valida stepId pertence ao flow (role ≠ agent) |

**Regra de PATCH /status (desativar fluxo):** ao desativar um fluxo (`status = inactive`), cancelar automaticamente todos os enrollments `active` desse fluxo com `cancel_reason = 'flow_deactivated'`. Isso permite que o DELETE subsequente seja executado sem conflito.

---

## Frontend (Web)

### Navegação

Adiciona item "Remarketing" na sidebar (`app-sidebar.tsx`) entre "Agentes" e "Configurações", com ícone `RefreshCw` do Lucide.

Rota: `/remarketing`

### Tela de lista — `/remarketing`

Segue o padrão da página de Agentes.

**Header:** título "Remarketing" + contador de fluxos + botão "+ Novo fluxo de remarketing"

**Tabela de fluxos** com colunas:
- Nome do fluxo
- Produto/campanha
- Agente de retorno
- Nº de etapas
- Status (badge: Ativo / Inativo)
- Última execução (`remarketing_flows.last_executed_at` — exibir "Nunca" se null)
- Ações: Editar, Duplicar, Ativar/Desativar, Excluir

**Estado vazio:** ilustração + "Nenhum fluxo de remarketing" + botão de criação.

### Tela de edição — `/remarketing/[flowId]/edit`

Layout de duas colunas:

**Coluna esquerda — Configurações do fluxo:**
- Campo: Nome do fluxo
- Campo: Produto/campanha
- Dropdown: Agente de retorno (agentes da org)
- Dropdown: Instância (instâncias da org)
- Campo numérico: Critério de entrada (X minutos sem resposta do cliente)
- Checkboxes: Regras de cancelamento (pré-selecionadas): Ao responder, Ao finalizar, Ao pedir para parar
- Toggle: Status ativo/inativo

**Coluna direita — Etapas:**
- Lista ordenada de etapas
- Cada etapa exibe: número, tempo de espera, tipo de mensagem, conteúdo, toggle ativo/inativo, botão excluir
- Botão "+ Adicionar etapa" ao final da lista

**Botões de ação:** Salvar / Cancelar

### Padrão visual

Seguir exatamente o mesmo padrão visual do restante da plataforma: cores `blue-electric`, `amber-fire`, `bg-card`, `border-border`, `text-muted-foreground`, fontes e espaçamentos idênticos.

---

## Fluxo padrão de exemplo

Criado automaticamente junto com a feature (seed ou documentação):

**Nome:** Remarketing Vector Black  
**Produto:** Vector Black  
**Agente:** Kalebe - Vendas  
**Critério:** 15 minutos sem resposta do cliente

| Etapa | Espera | Mensagem |
|---|---|---|
| 1 | 15 min | "Oi, vi que nossa conversa ficou pausada. Ficou alguma dúvida sobre o Vector Black? Estou aqui para te ajudar." |
| 2 | 24h | "Olá, passando para saber se ainda posso te ajudar a aproveitar a oferta especial do Vector Black. Se tiver qualquer dúvida, é só me chamar." |
| 3 | 48h | "Oi 😊 Esta será minha última mensagem para não te incomodar. Se ainda quiser conhecer melhor o Vector Black, basta responder esta conversa e continuo seu atendimento." |

---

## Fora do escopo

- Analytics / relatórios de conversão
- A/B testing de mensagens
- Remarketing por e-mail ou SMS
- Integração com CRM externo
- Envio de múltiplas mensagens simultâneas para a mesma conversa
- Cancelamento por compra concluída (sem sistema de e-commerce integrado)
