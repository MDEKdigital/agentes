# Design: Correções Técnicas — aula-agente

**Data:** 2026-06-10  
**Status:** Aprovado  
**Escopo:** 4 correções técnicas sequenciais

---

## Contexto

O projeto é uma plataforma SaaS multi-tenant de agentes de IA para WhatsApp. A base arquitetural está sólida, mas quatro falhas técnicas precisam ser corrigidas antes de evoluir o produto: `maxSteps` hardcoded, embeddings amarrados ao OpenAI, inbox ineficiente e ausência de testes automatizados.

---

## Fix 1 — `maxSteps` configurável por agente

### Problema
`maxSteps: 5` está hardcoded em `apps/worker/src/agents/agent-runner.ts`. Não há como ajustar o limite de iterações de ferramentas por agente.

### Mudanças

**Migration (Supabase):**
```sql
ALTER TABLE agents ADD COLUMN max_steps INTEGER NOT NULL DEFAULT 5;
ALTER TABLE agents ADD CONSTRAINT agents_max_steps_check CHECK (max_steps BETWEEN 1 AND 20);
```

**`packages/shared/src/types/agent.ts`:**
Adicionar `max_steps: number` ao interface `Agent`.

**`packages/shared/src/schemas/agent.ts`:**
Adicionar `max_steps: z.number().int().min(1).max(20).default(5)`.

**`apps/worker/src/agents/agent-runner.ts`:**
```ts
// Linha ~77 — substituir
maxSteps: agent.max_steps,
```

**`apps/web/src/components/agents/agent-form.tsx`:**
Adicionar campo numérico (input ou slider, range 1–20, label "Máximo de passos do agente") ao formulário de criação/edição.

### Restrições
- Range 1–20: mínimo garante funcionamento sem ferramentas; máximo protege contra custo descontrolado.
- Default 5 preserva comportamento atual em todos os agentes existentes.
- Migration não destrutiva — zero downtime.

---

## Fix 2 — Embeddings com fallback, sem dependência obrigatória do OpenAI

### Problema
`apps/worker/src/workers/process-document.ts` linha 59 chama `resolveApiKey(organizationId, "openai")`. Orgs que usam apenas Anthropic ou Google falham ao processar documentos por não terem chave OpenAI cadastrada.

### Mudanças

**`.env.example`:**
```env
# Chave OpenAI usada como fallback para embeddings quando a org não tem a própria
PLATFORM_OPENAI_EMBEDDING_KEY=
```

**`apps/worker/src/lib/vault.ts` — nova função:**
```ts
export async function resolveEmbeddingApiKey(organizationId: string): Promise<string> {
  try {
    return await resolveApiKey(organizationId, "openai");
  } catch {
    const fallback = process.env.PLATFORM_OPENAI_EMBEDDING_KEY;
    if (!fallback) {
      throw new Error(
        `No OpenAI key available for embeddings in org ${organizationId}. ` +
        `Set PLATFORM_OPENAI_EMBEDDING_KEY or add an OpenAI secret to the org.`
      );
    }
    return fallback;
  }
}
```

**`apps/worker/src/workers/process-document.ts`:**
```ts
// Substituir linha 59
const apiKey = await resolveEmbeddingApiKey(organizationId);
```

### Decisão arquitetural
Não foi adotada troca de provider de embeddings (Voyage/Cohere) porque a dimensão do pgvector está fixada em 1536 (OpenAI). Migrar exigiria reprocessar todos os documentos existentes. O fallback via env var resolve o problema prático sem tocar no schema do banco.

---

## Fix 3 — Inbox sem refetch total a cada evento Realtime

### Problema
`apps/web/src/app/(dashboard)/inbox/page.tsx` chama `fetchConversations()` (query completa) tanto no `onInsert` quanto no `onUpdate` do Supabase Realtime. Com volume alto de conversas, cada mensagem nova dispara uma re-fetch de todas as conversas.

### Mudanças

**`apps/web/src/app/(dashboard)/inbox/page.tsx`:**

Substituir os callbacks do `useRealtime`:

```ts
// onUpdate: aplicar patch direto no estado local
onUpdate: (payload) => {
  setConversations((prev) =>
    prev.map((c) =>
      c.id === payload.new.id
        ? { ...c, ...payload.new }
        : c
    )
  );
},

// onInsert: busca pontual só da conversa nova (com joins) e prepend
onInsert: async (payload) => {
  const supabase = createClient();
  const { data } = await supabase
    .from("conversations")
    .select("*, contacts(phone, name), agents(name)")
    .eq("id", payload.new.id)
    .single();
  if (data) {
    setConversations((prev) => [data as ConversationRow, ...prev]);
  }
},
```

**`apps/web/src/lib/realtime.ts`:**
Verificar se os callbacks `onInsert` e `onUpdate` já recebem `payload` com `new`. Se não, ajustar a assinatura do hook para passar `payload.new` e `payload.old` aos callbacks.

### Impacto esperado
- `onUpdate` (evento mais frequente): zero queries adicionais ao banco.
- `onInsert`: 1 query pontual em vez de N linhas.

---

## Fix 4 — Suite de testes automatizados (Vitest)

### Problema
Não há testes automatizados. Regressões são detectadas apenas em produção.

### Framework
**Vitest** — compatível nativamente com TypeScript, monorepos pnpm e ESM. Sem configuração extra.

### Estrutura de arquivos

```
apps/api/src/routes/webhooks/__tests__/evolution.test.ts
apps/api/src/services/__tests__/conversation.service.test.ts
apps/worker/src/agents/__tests__/agent-runner.test.ts
apps/worker/src/workers/__tests__/process-message.test.ts
apps/worker/src/workers/__tests__/process-document.test.ts
apps/worker/src/embeddings/__tests__/chunker.test.ts
packages/shared/src/__tests__/schemas.test.ts
```

### Cobertura por arquivo

| Arquivo | Tipo | O que testa |
|---|---|---|
| `agent-runner.test.ts` | unit | Provider certo instanciado; tools corretas por `tools_config`; `max_steps` do agente usado |
| `process-message.test.ts` | integration light | Agente inativo → skip; human takeover → skip; caminho feliz → salva + enfileira |
| `process-document.test.ts` | unit | Extração por tipo de arquivo; doc vazio → status error; fallback de embedding key |
| `chunker.test.ts` | unit puro | Tamanho dos chunks; overlap; texto vazio → array vazio |
| `evolution.test.ts` | integration light | `fromMe` → skip; instância desconhecida → skip; human takeover → skip; caminho feliz → 200 + messageId |
| `schemas.test.ts` | unit puro | Schemas Zod: inputs válidos passam, inválidos rejeitam com mensagem correta |

### Configuração

Adicionar em cada `package.json` com testes:
```json
"scripts": {
  "test": "vitest run",
  "test:watch": "vitest"
},
"devDependencies": {
  "vitest": "^2.0.0"
}
```

Adicionar no `turbo.json`:
```json
"test": {
  "dependsOn": ["^build"],
  "outputs": []
}
```

### Mocks necessários
- `generateText` do AI SDK (agent-runner)
- `getAdminClient` e funções de DB (process-message, process-document)
- `getSendMessageQueue` (process-message)
- `fetch` global (process-document, send-message)
- Fastify `inject` para testes de rota (evolution webhook)

---

## Ordem de execução

| # | Fix | Esforço estimado | Risco |
|---|---|---|---|
| 1 | `maxSteps` configurável | Baixo (1 migration + 3 arquivos) | Mínimo |
| 2 | Embeddings com fallback | Baixo (1 função + 1 env var) | Mínimo |
| 3 | Inbox otimizado | Médio (lógica de estado + hook) | Baixo |
| 4 | Testes automatizados | Alto (setup + 7 arquivos de teste) | Mínimo |

---

## Critérios de sucesso

- [ ] Agente com `max_steps: 3` executa no máximo 3 iterações de ferramenta
- [ ] Org sem chave OpenAI processa documentos usando `PLATFORM_OPENAI_EMBEDDING_KEY`
- [ ] Nenhum `fetchConversations()` disparado em evento `onUpdate` do Realtime
- [ ] `pnpm test` passa sem erros cobrindo os 4 caminhos críticos listados
