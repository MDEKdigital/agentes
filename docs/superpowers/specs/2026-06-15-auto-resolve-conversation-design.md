# Auto-Resolução de Conversa — Design Spec

**Data:** 2026-06-15
**Status:** Aprovado

---

## Overview

Implementar detecção automática de encerramento de conversa pelo agente IA, com confirmação natural ao cliente e marcação automática do status como `"resolved"`. Garantir que conversas resolvidas não recebam remarketing e que clientes que retornam tenham o atendimento reaberto sem repetição de saudação.

---

## Contexto e estado atual

- `conversations.status` já possui os valores `"open"`, `"waiting"`, `"resolved"`, `"closed"`
- `isConversationResolved` já existe em `packages/database/src/queries/remarketing.ts` e é chamado pelo remarketing-worker
- `getConversationsEligibleForEnrollment` já filtra por `["open", "waiting"]` — conversas resolvidas não são enroladas
- `findOpenConversation` filtra por `["open", "waiting"]` — conversa resolvida não é encontrada, gerando nova conversa ao invés de reabrir
- Nenhuma migração de banco é necessária

---

## Escopo

Seis arquivos modificados/criados, todos no worker e no pacote database. Nenhuma mudança na API (`apps/api/src/routes`) nem no dashboard (`apps/web`).

---

## Arquitetura

### Novo arquivo: `apps/worker/src/agents/tools/close-conversation.ts`

Tool que o agente chama quando o cliente confirma o encerramento. Recebe `conversationId` via closure (mesmo padrão de `search-knowledge` e `search-faq`).

```
buildCloseConversationTool(conversationId: string) → Tool
```

- **description:** instrui o LLM a usar a tool somente após confirmação explícita do cliente
- **parameters:** `z.object({})` — nenhum parâmetro necessário; a chamada em si já é o sinal
- **execute:** chama `updateConversation(db, conversationId, { status: "resolved" })` e retorna `{ success: true }`

O agente envia a mensagem de despedida como texto normal; a tool cuida apenas do status no banco.

### Modificação: `apps/worker/src/agents/tools/registry.ts`

- Adicionar `conversationId: string` nos parâmetros de `buildToolsForAgent`
- Registrar `close_conversation: buildCloseConversationTool(conversationId)` incondicionalmente (não gateado por `tools_config`)

### Modificação: `apps/worker/src/agents/agent-runner.ts`

- Adicionar `conversationId: string` em `RunAgentParams`
- Passar `conversationId` para `buildToolsForAgent`
- No início de `runAgent`, antes do loop de tentativas, computar `effectiveBasePrompt`:

```typescript
const CLOSE_CONVERSATION_INSTRUCTION = `
[REGRA DE ENCERRAMENTO — SEMPRE ATIVA]
Quando o cliente demonstrar que não precisa de mais ajuda (ex: "obrigado", "valeu", "era só isso", "tudo certo", "resolveu", "já comprei", "pode encerrar", "não tenho mais dúvidas"), responda de forma natural e pergunte: "Posso ajudar em mais alguma coisa, ou posso finalizar seu atendimento?"
Se o cliente confirmar o encerramento, envie uma mensagem de despedida natural E chame a ferramenta close_conversation.
Se o cliente ainda tiver dúvidas, continue o atendimento normalmente sem chamar close_conversation.
Quando uma conversa for reaberta (o histórico mostra mensagens anteriores encerradas), não repita a saudação inicial — retome diretamente.
`.trim();

const effectiveBasePrompt = `${agent.system_prompt}\n\n${CLOSE_CONVERSATION_INSTRUCTION}`;
let systemPrompt = effectiveBasePrompt;
```

Usar `effectiveBasePrompt` (não `agent.system_prompt`) onde quer que o prompt base seja referenciado dentro de `runAgent` — inclusive na lógica de retry de violation, que atualmente reseta para `agent.system_prompt`. Isso garante que a instrução de encerramento persista em todas as tentativas.

### Modificação: `apps/worker/src/workers/process-message.ts`

- Passar `conversationId` ao chamar `runAgent`
- Após o `runAgent`, verificar se `close_conversation` foi chamada via `result.toolCalls` e condicionar o status do `updateConversation` final:

```typescript
const wasResolved = result.toolCalls.includes("close_conversation");
await updateConversation(db, conversationId, {
  last_message_at: new Date().toISOString(),
  status: wasResolved ? "resolved" : "waiting",
});
```

Sem essa condicional, o `updateConversation` incondicional sobrescreveria o `"resolved"` gravado pela tool durante o `runAgent`, neutralizando a feature.

### Modificação: `packages/database/src/queries/conversations.ts`

`findOpenConversation` expande o filtro:

```typescript
.in("status", ["open", "waiting", "resolved"])
```

Ordenação por `created_at DESC` já existente garante que a conversa mais recente seja retornada. Se existir uma conversa `"open"` mais recente que a `"resolved"`, ela é retornada — comportamento correto.

### Modificação: `apps/api/src/services/conversation.service.ts`

Em `ensureConversation`, após encontrar a conversa existente:

```typescript
if (existing.status === "resolved") {
  const reopened = await updateConversation(db, existing.id, { status: "open" });
  return { conversation: reopened, contact, isNew: false };
}
```

---

## Fluxo de encerramento

```
Cliente: "obrigado, resolveu"
  → Agente: "Fico feliz em ter ajudado! Posso ajudar em mais alguma coisa, ou posso finalizar seu atendimento?"

Cliente: "pode encerrar"
  → Agente: "Até logo! Qualquer dúvida é só chamar." + chama close_conversation
  → close_conversation: UPDATE conversations SET status = 'resolved'
  → process-message: enfileira mensagem de despedida normalmente
  → Remarketing: conversa resolvida — não enrola, cancela se já estava enrolada
```

---

## Fluxo de reabertura

```
[Conversa status = "resolved"]
Cliente: "oi, tenho mais uma dúvida"
  → ensureConversation: findOpenConversation retorna conversa "resolved"
  → ensureConversation: UPDATE status = "open"
  → Mensagem criada na mesma conversa
  → PROCESS_MESSAGE enfileirado
  → Agente: vê histórico completo, não repete saudação (instrução global)
```

---

## Remarketing — sem mudanças

| Cenário | Comportamento atual | Mudança necessária |
|---|---|---|
| Conversa resolvida tenta ser enrolada | Bloqueada por `["open", "waiting"]` filter | Nenhuma |
| Enrollment ativo → conversa resolvida | Cancelado por `isConversationResolved` | Nenhuma |
| Conversa reaberta → reenroll | Só após silêncio configurado no fluxo | Nenhuma |

---

## Tratamento de erros

- Se `updateConversation` falhar dentro da tool, o erro propaga para o Vercel AI SDK, que o retorna ao agente como falha de tool. O agente pode tentar novamente ou informar o cliente. O job BullMQ não é afetado.
- A tool nunca impede o envio da mensagem de despedida — o texto já foi gerado antes da tool executar no ciclo do AI SDK.

## Correções incorporadas do code review

### 1. updateConversation condicional em process-message
O `updateConversation` final em `process-message.ts` sempre sobrescrevia o status com `"waiting"`. Corrigido: verificar `result.toolCalls.includes("close_conversation")` e definir `status: wasResolved ? "resolved" : "waiting"`.

### 2. Race remarketing na janela de reabertura
Quando `ensureConversation` reativa a conversa (`"resolved"` → `"open"`), o ciclo de remarketing (60s) pode rodar antes da mensagem do contato ser gravada, enrolando a conversa indevidamente. Mitigação: o remarketing já verifica `last_message_at` implicitamente via contagem de mensagens recentes — a janela de exposição é de até 60s. Aceitável por ora; mitigação futura: filtrar também por `last_message_at`.

### 3. effectiveBasePrompt no retry loop
Já documentado na Seção agent-runner: usar `effectiveBasePrompt` em todos os pontos onde `agent.system_prompt` é referenciado dentro de `runAgent`, inclusive na linha de reconstrução do prompt após violation.

### 4. Testes com novo parâmetro conversationId
Todos os call sites de `runAgent` e `buildToolsForAgent` nos arquivos de teste precisam receber o novo parâmetro `conversationId`. Coberto explicitamente nos testes listados abaixo.

---

## Testes

### `close-conversation.test.ts` (unit)
- Chama `updateConversation` com `status: "resolved"`
- Retorna `{ success: true }`

### `process-message.test.ts` (adições)
- Quando agente chama `close_conversation` → `updateConversation` recebe `status: "resolved"`
- Mensagem de resposta ainda é enfileirada mesmo com tool call

### `conversation.service.test.ts` (novo)
- Conversa `"resolved"` existente → `ensureConversation` reativa para `"open"`, não cria nova
- Conversa `"open"` existente → comportamento inalterado
- Sem conversa existente → cria nova (comportamento inalterado)

---

## Arquivos modificados

| Arquivo | Tipo |
|---|---|
| `apps/worker/src/agents/tools/close-conversation.ts` | Novo |
| `apps/worker/src/agents/tools/registry.ts` | Modificado |
| `apps/worker/src/agents/agent-runner.ts` | Modificado |
| `apps/worker/src/workers/process-message.ts` | Modificado |
| `packages/database/src/queries/conversations.ts` | Modificado |
| `apps/api/src/services/conversation.service.ts` | Modificado |

---

## Fora do escopo

- Configuração por agente do comportamento de encerramento
- Status intermediário `"pending_close"`
- Limite de tempo para reabertura de conversas antigas resolvidas
- Interface no dashboard para visualizar conversas resolvidas (já funciona via filtro de status existente)
- Notificação ao operador humano quando uma conversa é auto-resolvida
