# Remarketing Module — Design Spec

**Date:** 2026-06-14  
**Status:** Approved

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
| `agent_id` | uuid FK → agents | Agente de IA para retorno ao responder |
| `instance_id` | uuid FK → evolution_instances | Filtro: só conversas dessa instância |
| `status` | enum (active, inactive) | |
| `entry_silence_minutes` | integer | Tempo sem resposta para entrar no fluxo |
| `cancel_on_reply` | boolean default true | Cancelar quando cliente responder |
| `cancel_on_resolved` | boolean default true | Cancelar quando atendimento finalizar |
| `cancel_on_purchase` | boolean default true | Cancelar quando compra concluída |
| `cancel_on_opt_out` | boolean default true | Cancelar quando cliente pedir para parar |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

### `remarketing_steps`

Etapas de cada fluxo, em ordem.

| Coluna | Tipo | Descrição |
|---|---|---|
| `id` | uuid PK | |
| `flow_id` | uuid FK → remarketing_flows | |
| `step_order` | integer | Ordem de execução (1, 2, 3…) |
| `wait_minutes` | integer | Tempo de espera desde a etapa anterior (ou desde o enrollment para etapa 1) |
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
| `current_step` | integer | Próxima etapa a enviar (baseada em `step_order`) |
| `enrolled_at` | timestamptz | Quando entrou no fluxo |
| `last_step_sent_at` | timestamptz | Quando a última etapa foi enviada |
| `status` | enum (active, completed, cancelled) | |
| `cancel_reason` | text nullable | Ex: "reply", "resolved", "opt_out" |
| `created_at` | timestamptz | |

**Regra:** uma conversa só pode ter um enrollment com status `active` por vez.

---

## Motor de Remarketing (Worker)

### Abordagem: Polling Worker

Novo worker `remarketing-worker.ts` em `apps/worker/src/workers/`, seguindo o padrão do `takeover-timeout`. Roda a cada minuto via BullMQ scheduler.

### Ciclo de execução

**Passo 1 — Detectar novas entradas:**
- Busca conversas com status `open` ou `waiting`, cujo `agent_id` corresponde a um fluxo ativo, cuja `instance_id` corresponde ao filtro do fluxo, e onde `updated_at` (último evento) está há mais de `entry_silence_minutes` atrás.
- Exclui conversas que já têm enrollment `active`.
- Para cada conversa elegível: cria um `remarketing_enrollment` com `current_step = 1` e `status = active`.

**Passo 2 — Processar etapas pendentes:**
- Busca todos os enrollments `active`.
- Para cada enrollment, obtém a próxima etapa ativa (`step_order = current_step`).
- Verifica: `last_step_sent_at + wait_minutes <= agora` (ou `enrolled_at + wait_minutes` para etapa 1).
- Antes de enviar, verifica regras de cancelamento (cliente respondeu após enrollment, conversa resolvida, etc.). Se cancelar, marca enrollment como `cancelled`.
- Envia mensagem via fila `send-message` existente.
- Atualiza `last_step_sent_at` e avança `current_step`.
- Se não houver próxima etapa ativa, marca enrollment como `completed`.

### Fila

Nova entrada `REMARKETING` em `packages/shared/src/constants.ts` → `QUEUE_NAMES`.  
Nova fila `getRemarketing Queue()` em `packages/queue/src/queues.ts`.

### Regras obrigatórias

- Nunca enviar duas etapas ao mesmo tempo para a mesma conversa.
- Nunca repetir uma etapa já enviada para o mesmo enrollment.
- Se `cancel_on_reply = true` e o cliente enviou mensagem após `enrolled_at`: cancelar e devolver conversa ao agente de IA (`agent_id` do fluxo).
- Registrar todas as mensagens enviadas como mensagens normais na tabela `messages` (role: `agent`).

---

## API (Backend)

Novas rotas em `apps/api/src/routes/remarketing/`. Todas exigem autenticação e validam `organization_id` via middleware existente.

### Fluxos

| Método | Rota | Ação |
|---|---|---|
| GET | `/remarketing/flows` | Lista fluxos da organização |
| POST | `/remarketing/flows` | Cria fluxo |
| PUT | `/remarketing/flows/:id` | Edita fluxo |
| DELETE | `/remarketing/flows/:id` | Remove fluxo (e suas etapas e enrollments) |
| POST | `/remarketing/flows/:id/duplicate` | Duplica fluxo com todas as etapas |
| PATCH | `/remarketing/flows/:id/status` | Ativa ou desativa fluxo |

### Etapas

| Método | Rota | Ação |
|---|---|---|
| GET | `/remarketing/flows/:id/steps` | Lista etapas do fluxo |
| POST | `/remarketing/flows/:id/steps` | Adiciona etapa |
| PUT | `/remarketing/flows/:id/steps/:stepId` | Edita etapa |
| DELETE | `/remarketing/flows/:id/steps/:stepId` | Remove etapa |
| PATCH | `/remarketing/flows/:id/steps/:stepId/status` | Ativa/desativa etapa |

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
- Última execução
- Ações: Editar, Duplicar, Ativar/Desativar, Excluir

**Estado vazio:** ilustração + "Nenhum fluxo de remarketing" + botão de criação.

### Tela de edição — `/remarketing/[flowId]/edit`

Layout de duas colunas:

**Coluna esquerda — Configurações do fluxo:**
- Campo: Nome do fluxo
- Campo: Produto/campanha
- Dropdown: Agente de retorno (agentes da org)
- Dropdown: Instância (instâncias da org)
- Campo numérico: Critério de entrada (X minutos sem resposta)
- Checkboxes: Regras de cancelamento (pré-selecionadas)
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
**Critério:** 15 minutos sem resposta

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
