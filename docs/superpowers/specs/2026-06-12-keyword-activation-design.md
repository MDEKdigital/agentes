# Ativação de Agente por Palavra-chave

**Data:** 2026-06-12  
**Status:** Aprovado (revisado após code review)

## Visão Geral

Adicionar uma área de ativação por palavra-chave no formulário de agentes (`/agentes`), posicionada acima do system prompt. Quando um agente tem keywords configuradas, ele ignora mensagens do contato até que uma delas faça match por regex — a partir daí, a conversa fica permanentemente ativada e o agente responde normalmente a tudo.

## Comportamento

- **Sem keywords configuradas:** agente sempre ativo (comportamento atual preservado).
- **Com keywords:** o agente ignora mensagens silenciosamente (não envia resposta, mas a mensagem é gravada no histórico) até que uma mensagem faça match com pelo menos uma das regexes.
- **Após ativação:** o agente responde normalmente a todas as mensagens seguintes naquela conversa, permanentemente.
- **Matching:** `new RegExp(keyword, 'i')` — case-insensitive. Regex inválida é ignorada com warning no log. Keywords vazias ou só com espaços são filtradas antes do teste.
- **Mensagens de mídia antes da ativação:** `content` NUNCA é null — o webhook sempre grava placeholders como `[áudio]`, `[imagem]`, `[vídeo]`, etc. O teste de regex roda contra esse conteúdo bruto (pré-preprocessing). Keywords que façam match com esses placeholders (ex: `áudio`, `\[`) causarão ativação involuntária — o usuário deve ser orientado a evitar esses padrões.
- **Human takeover:** se `is_human_takeover = true` quando a keyword chegar, o webhook não enfileira o job e `is_keyword_activated` não é atualizado. Após o takeover expirar, o contato precisa reenviar a keyword. Isso é comportamento esperado — human takeover suspende toda atividade do bot, incluindo detecção de keywords.

## Banco de Dados

### Migração `00021_agent_keyword_activation.sql`

```sql
-- Lista de regexes de ativação no agente (vazia = sempre ativo)
ALTER TABLE agents ADD COLUMN activation_keywords text[] NOT NULL DEFAULT '{}';

-- Estado de ativação por conversa
-- DEFAULT false: todas as conversas começam não-ativadas
-- O UPDATE abaixo imediatamente ativa conversas de agentes sem keywords
ALTER TABLE conversations ADD COLUMN is_keyword_activated boolean NOT NULL DEFAULT false;

-- Backfill: ativar conversas de agentes que não têm keywords configuradas
-- (agentes com keywords ficam false até o contato enviar a keyword)
UPDATE conversations
SET is_keyword_activated = true
WHERE agent_id IN (
  SELECT id FROM agents WHERE activation_keywords = '{}'
);
```

**Importante:** usar `DEFAULT false` + UPDATE de backfill, e NÃO `DEFAULT true`. Com `DEFAULT true`, toda conversa existente — incluindo as de agentes que receberão keywords depois — seria marcada como ativada, bypassando silenciosamente o gate para sempre.

**Conversas novas:** `createConversation` deve receber `is_keyword_activated` calculado pelo caller com base em `agent.activation_keywords.length === 0`. Ver seção do webhook abaixo.

## Schema e Tipos

**`packages/shared/src/schemas/agent.ts`**
```ts
// .min(1) previne que strings vazias cheguem ao worker e matchem tudo
activation_keywords: z.array(z.string().min(1)).default([]),
```

**`packages/shared/src/types/agent.ts`**
```ts
activation_keywords: string[];
```

**`packages/shared/src/types/conversation.ts`**
```ts
is_keyword_activated: boolean;
```

## Webhook (`apps/api/src/routes/webhooks/evolution.ts`)

O webhook já tem `agentId` via `instance.active_agent_id`. Antes de chamar `ensureConversation`, deve buscar o agente para calcular o valor inicial de `is_keyword_activated`:

```ts
// Após resolver agentId, buscar o agente para calcular ativação inicial
const agent = await getAgentById(getAdminClient(), agentId);

const { conversation } = await ensureConversation({
  organizationId,
  agentId,
  instanceId: instance.id,
  phone,
  contactName,
  contactPhotoUrl: null,
  isKeywordActivated: agent.activation_keywords.length === 0,
});
```

`EnsureConversationParams` deve receber o novo campo `isKeywordActivated: boolean`, que é passado para `createConversation` no insert de novas conversas. Para conversas existentes retornadas por `findOpenConversation`, o campo já está no DB e não é alterado.

## Worker (`apps/worker/src/workers/process-message.ts`)

### Tipagem da conversa

O worker atualmente faz `as Record<string, unknown>` na conversa. Com `is_keyword_activated` sendo um campo crítico de controle, o acesso deve ser tipado. A variável `conversation` deve ser retipada como `Conversation` (ou ter os campos acessados via cast explícito), para que typos como `is_keyword_activat` sejam capturados pelo TypeScript em compilação.

### Ordenação das operações

O keyword guard deve ser inserido **antes de `getRecentMessages`** — se a mensagem não ativar o agente, a query de 20 linhas é desnecessária.

Ordem correta:

```
1. getAgentById          ← já existe
2. is_active check       ← já existe
3. getConversationById   ← já existe
4. is_human_takeover check ← já existe
5. resolveApiKey         ← já existe
6. *** KEYWORD GUARD ***  ← inserir aqui (antes de getRecentMessages)
7. getRecentMessages     ← mover para depois do guard
8. media preprocessing
9. runAgent
```

### Pseudocódigo do keyword guard

```
se agent.activation_keywords.length > 0
  e conversation.is_keyword_activated === false
    const content = currentMessage.content  // nunca null, pode ser placeholder
    const keywords = agent.activation_keywords.filter(k => k.trim().length > 0)
    const matched = keywords.some(keyword => {
      try { return new RegExp(keyword, 'i').test(content) }
      catch { console.warn(`[keyword-gate] regex inválida: ${keyword}`); return false }
    })
    se matched:
        await updateConversation(db, conversationId, { is_keyword_activated: true })
        continuar processamento normalmente
    se não:
        return (silencioso)
```

Pontos importantes:
- Usar `Array.prototype.some()` para short-circuit no primeiro match (não iterar keywords desnecessariamente)
- Filtrar keywords vazias/whitespace no worker como segunda linha de defesa (além do schema)
- A atualização ocorre dentro do bloco protegido pelo lock de conversa — sem race condition

## UI (`apps/web/src/components/agents/agent-form.tsx`)

Nova seção **"Ativação por Palavra-chave"** inserida entre o campo `description` e o campo `system_prompt`, dentro do card "Informações Básicas".

**Componente:** existe em `apps/web/src/components/inbox/tags-input.tsx` um `TagsInput` com lógica de chip/tag. Ele é acoplado ao Supabase via `conversationId`, mas a lógica de UI (chip render + Enter-to-add) deve ser extraída como um componente controlado reutilizável (`value: string[]` + `onChange: (v: string[]) => void`) para ser usado aqui — sem duplicar o código de chip.

- Usuário digita uma regex e pressiona `Enter` ou `,` para adicionar como tag
- Cada tag exibe um `×` para remover
- Entradas com apenas espaços em branco são descartadas no onChange
- O valor é sincronizado com `form.setValue("activation_keywords", [...])`
- Texto de ajuda: "Deixe vazio para o agente sempre responder. Cada entrada é uma regex (case-insensitive). Evite padrões que matchem placeholders de mídia como `[áudio]`."

## Fluxo Completo

```
Mensagem chega → webhook busca instance + agent
  ↓
ensureConversation com is_keyword_activated = (agent.activation_keywords.length === 0)
  ↓
Webhook: is_human_takeover? → sim: skipped (keyword não avaliada durante takeover)
  ↓
Enfileira job → worker adquire lock
  ↓
agent.activation_keywords vazio?
  → sim: busca histórico → processa normalmente
  → não:
      conversation.is_keyword_activated?
        → true: busca histórico → processa normalmente
        → false: testa regexes contra conteúdo bruto da mensagem
            match? → atualiza DB → busca histórico → processa normalmente
            sem match? → return (silencioso, sem buscar histórico)
```

## O que não está no escopo

- Validação de regex no frontend — o schema Zod valida `string().min(1)` mas não valida sintaxe de regex; erros são capturados em runtime no worker.
- Palavra-chave de desativação.
- Timeout de sessão / reativação.
- Resposta automática antes da ativação.
- Ativação de keyword durante human takeover — comportamento definido: keyword é ignorada enquanto takeover está ativo.
