# Ativação de Agente por Palavra-chave

**Data:** 2026-06-12  
**Status:** Aprovado

## Visão Geral

Adicionar uma área de ativação por palavra-chave no formulário de agentes (`/agentes`), posicionada acima do system prompt. Quando um agente tem keywords configuradas, ele ignora mensagens do contato até que uma delas faça match por regex — a partir daí, a conversa fica permanentemente ativada e o agente responde normalmente a tudo.

## Comportamento

- **Sem keywords configuradas:** agente sempre ativo (comportamento atual preservado).
- **Com keywords:** o agente ignora mensagens silenciosamente (não envia resposta, mas a mensagem é gravada no histórico) até que uma mensagem faça match com pelo menos uma das regexes.
- **Após ativação:** o agente responde normalmente a todas as mensagens seguintes naquela conversa, permanentemente.
- **Matching:** `new RegExp(keyword, 'i')` — case-insensitive. Regex inválida é ignorada com warning no log.
- **Mensagens de mídia antes da ativação:** `content` pode ser `null`; nenhuma regex fará match, agente permanece inativo — comportamento seguro.

## Banco de Dados

### Migração `00021_agent_keyword_activation.sql`

```sql
-- Lista de regexes de ativação no agente (vazia = sempre ativo)
ALTER TABLE agents ADD COLUMN activation_keywords text[] NOT NULL DEFAULT '{}';

-- Estado de ativação por conversa
-- true quando: agente sem keywords OU keyword já detectada
ALTER TABLE conversations ADD COLUMN is_keyword_activated boolean NOT NULL DEFAULT true;
```

**Nota:** conversas novas criadas para um agente com keywords devem receber `is_keyword_activated = false` no insert — a query `createConversation` precisa receber esse valor calculado pelo caller com base em `agent.activation_keywords.length > 0`.

## Schema e Tipos

**`packages/shared/src/schemas/agent.ts`**
```ts
activation_keywords: z.array(z.string()).default([]),
```

**`packages/shared/src/types/agent.ts`**
```ts
activation_keywords: string[];
```

**`packages/shared/src/types/conversation.ts`**
```ts
is_keyword_activated: boolean;
```

## Worker (`apps/worker/src/workers/process-message.ts`)

Inserir checagem logo após buscar `agent` e `conversation`, antes de qualquer lógica de mídia ou execução do agente:

```
se agent.activation_keywords.length > 0
  e conversation.is_keyword_activated === false
    → para cada keyword:
        try { new RegExp(keyword, 'i').test(currentMessage.content ?? '') }
        catch { log warning, skip keyword }
    → se alguma fizer match:
        await updateConversation(db, conversationId, { is_keyword_activated: true })
        continuar processamento normalmente
    → se nenhuma fizer match:
        return (silencioso)
```

A atualização ocorre dentro do bloco protegido pelo lock de conversa — sem race condition.

## UI (`apps/web/src/components/agents/agent-form.tsx`)

Nova seção **"Ativação por Palavra-chave"** inserida entre o campo `description` e o campo `system_prompt`, dentro do card "Informações Básicas".

**Componente:** input de tags local (sem biblioteca externa).
- Usuário digita uma regex e pressiona `Enter` ou `,` para adicionar como tag.
- Cada tag exibe um `×` para remover.
- O valor é sincronizado com `form.setValue("activation_keywords", [...])`.
- Entradas com apenas espaços em branco são descartadas.
- Texto de ajuda: "Deixe vazio para o agente sempre responder. Cada entrada é uma regex (case-insensitive)."

## Fluxo Completo

```
Mensagem chega → worker busca agent + conversation
  ↓
agent.activation_keywords vazio?
  → sim: processa normalmente
  → não:
      conversation.is_keyword_activated?
        → true: processa normalmente
        → false: testa regexes contra mensagem
            match? → atualiza DB → processa normalmente
            sem match? → return (silencioso)
```

## O que não está no escopo

- Validação de regex no frontend (erro capturado em runtime no worker).
- Palavra-chave de desativação.
- Timeout de sessão / reativação.
- Resposta automática antes da ativação.
