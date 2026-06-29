# Design: Reestruturação do Sistema de Agentes + Salomão Drawer + SSE

**Data:** 2026-06-28  
**Status:** Aprovado  
**Abordagem escolhida:** Opção B — Reestruturação completa de uma vez

---

## 1. Contexto e Problema

O sistema atual tem o Salomão vivendo dentro da página `/prompt-library` como um overlay fullscreen (`fixed inset-0`). O fluxo de criação de agentes é desconexo: o usuário vai para a Biblioteca de Prompts, conversa com o Salomão, copia o prompt gerado, navega para `/agents/new` e cola manualmente. Não há streaming — a resposta só aparece quando a IA termina de gerar tudo. O input perde o foco após cada envio.

O objetivo é transformar o sistema em uma plataforma conversacional fluida, com o Salomão integrado diretamente na área de agentes como um drawer lateral, streaming real token-a-token, e input persistente (comportamento igual ao ChatGPT e WhatsApp).

---

## 2. Escopo

### Incluído
- Novo endpoint SSE para streaming do Salomão
- `SalomaoDrawer` como Sheet lateral na página `/agents`
- Hook `use-salomao-stream` com suporte a SSE
- Input persistente (foco mantido após envio)
- Textarea auto-expansivo no drawer e no AgentForm
- Renomear "Biblioteca de Prompts" → "Biblioteca de Agentes" na nav
- Remover `SalomaoStudio` da página `/prompt-library`
- Seção Admin do Salomão no painel-gestor com tabela `salomao_config`

### Excluído (deferred)
- RBAC granular além do que já existe
- Observabilidade avançada (métricas de abandono, latência por sessão)
- WebSocket (SSE é suficiente e mais simples)
- Múltiplos idiomas

---

## 3. Arquitetura Geral

```
ANTES                              DEPOIS
─────────────────────────────      ─────────────────────────────
/prompt-library                    /agents
  └─ SalomaoStudio (overlay)         ├─ AgentsPage
                                     │    └─ SalomaoDrawer (Sheet)
/agents/new (form page)              │         ├─ ChatPanel (SSE)
                                     │         └─ PromptPreviewPanel
                                     └─ "Criar Agente" → abre drawer
                                                       ↓ copia prompt
                                     /agents/new?prompt=...

Sidebar: "Biblioteca de Prompts"   Sidebar: "Biblioteca de Agentes"

Backend: POST /chat (sync)         Backend: POST /chat/stream (SSE)
  retorna json completo              stream chunk-by-chunk
                                     POST /chat mantido como fallback
```

---

## 4. Fluxo do Usuário

1. Usuário entra em `/agents`
2. Clica em "Criar Agente" (botão existente no header)
3. `SalomaoDrawer` abre como Sheet pela direita
4. Salomão inicia conversa automaticamente (primeira mensagem via SSE)
5. Usuário responde — Enter envia, Shift+Enter quebra linha, foco nunca perde
6. Salomão faz perguntas uma a uma (nome, nicho, tom, limites, etc.)
7. Quando informação suficiente: Salomão avisa e gera o prompt
8. Prompt aparece streamando no painel de preview à direita do chat
9. Dois botões aparecem:
   - "Copiar prompt" → clipboard
   - "Usar este prompt" → navega para `/agents/new?prompt=<encoded>`
10. `AgentForm` recebe o prompt via query param e preenche `system_prompt`

---

## 5. Componentes Frontend

### Estrutura de arquivos

```
apps/web/src/
├── components/agents/
│   ├── salomao-drawer.tsx          ← NOVO
│   │     ├── ChatPanel             ← mensagens + streaming
│   │     ├── PromptPreviewPanel    ← prompt gerado + botões
│   │     └── PersistentInput      ← textarea + foco + auto-expand
│   ├── agent-card.tsx              ← sem mudança
│   └── agent-form.tsx             ← adiciona auto-expand em system_prompt
│
├── hooks/
│   └── use-salomao-stream.ts      ← NOVO
│
├── app/(dashboard)/
│   ├── agents/
│   │   └── page.tsx               ← adiciona <SalomaoDrawer>
│   └── prompt-library/
│       └── page.tsx               ← remove SalomaoStudio, mantém templates
│
└── components/layout/
    └── app-sidebar.tsx            ← renomeia item de nav
```

### SalomaoDrawer

Usa o componente Shadcn `Sheet` com `side="right"` e `className="w-full max-w-3xl"`.

Internamente dividido em dois painéis:
- **Esquerdo (55%):** `ChatPanel` — lista de mensagens com bubbles, typing indicator (3 dots), área de input
- **Direito (45%):** `PromptPreviewPanel` — textarea read-only com o prompt acumulado, botões de ação

Estados do drawer: `closed | opening | idle | connecting | streaming | done | error | retry`

### PersistentInput

```tsx
// Comportamento obrigatório
const inputRef = useRef<HTMLTextAreaElement>(null)

// Auto-expand
function autoResize(el: HTMLTextAreaElement) {
  el.style.height = 'auto'
  el.style.height = Math.min(el.scrollHeight, 200) + 'px'
}

// Foco persistente após envio
async function handleSend() {
  // ... envia
  inputRef.current?.focus()  // nunca perde cursor
}

// Teclado
onKeyDown: Enter → envia | Shift+Enter → \n | Ctrl+Enter → alternativo
```

### use-salomao-stream

```ts
// Estados
type StreamState = 'idle' | 'connecting' | 'streaming' | 'done' | 'error'

// Conecta via fetch nativo + ReadableStream (sem bibliotecas extras)
// AbortController para cancelar se drawer fechar durante streaming
// Parser de linhas SSE: "data: {...}\n\n"
// Callbacks: onChunk(text), onPromptReady(prompt), onDone(), onError(msg)
```

---

## 6. Backend — Endpoint SSE

### Novo endpoint

```
POST /organizations/:orgId/prompt-studio/chat/stream
```

**Headers de resposta:**
```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
X-Accel-Buffering: no
```

**Formato dos eventos SSE:**
```
data: {"type":"chunk","content":"texto parcial aqui"}\n\n
data: {"type":"prompt","content":"<prompt completo gerado>"}\n\n
data: {"type":"done"}\n\n
data: {"type":"error","message":"descrição do erro"}\n\n
```

**Fluxo no handler:**
1. Valida membership (igual ao POST existente)
2. Resolve API key da org
3. Seta headers SSE e inicia resposta
4. Chama OpenAI com `stream: true`
5. Para cada chunk: emite `{"type":"chunk","content":"..."}` e monitora acumulação de `<prompt>...</prompt>`
6. Quando detecta fechamento de `</prompt>`: extrai o prompt e emite `{"type":"prompt","content":"..."}`
7. Roda Salomão Auditor no prompt extraído
8. Se reprovado: emite `{"type":"error","message":"..."}` e encerra
9. Se aprovado: emite `{"type":"done"}` e encerra

**Endpoint antigo** `POST /chat` permanece inalterado — zero breaking changes.

---

## 7. Admin do Salomão (painel-gestor)

### Migração de banco

```sql
CREATE TABLE salomao_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  system_prompt text NOT NULL,
  updated_at timestamptz DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);

-- Seed com o prompt atual hardcoded
INSERT INTO salomao_config (system_prompt) VALUES ('<prompt atual>');
```

### Endpoints (super-admin only)

```
GET  /admin/salomao-config         → retorna { system_prompt, updated_at }
PATCH /admin/salomao-config        → atualiza system_prompt
```

### UI no painel-gestor

Seção "Salomão" adicionada ao `/painel-gestor`:
- Textarea expansivo com o system prompt atual
- Botão "Salvar alterações"
- Timestamp "Última atualização"
- Aviso: "Alterações afetam todas as organizações imediatamente"

O endpoint SSE passa a ler o prompt da tabela `salomao_config` em vez do hardcode.

---

## 8. Comportamento de Dados

- O drawer **não salva automaticamente** o prompt gerado
- O usuário escolhe: copiar ou usar diretamente no form de criação
- A tabela `saved_prompts` continua existindo para quem quiser salvar manualmente
- A aba "Meus Prompts" na Biblioteca de Agentes continua funcionando normalmente
- **Nenhuma migração** além da tabela `salomao_config`

---

## 9. Renomeação de Navegação

```ts
// app-sidebar.tsx — antes
{ name: "Biblioteca de Prompts", href: "/prompt-library", icon: BookOpen }

// depois
{ name: "Biblioteca de Agentes", href: "/prompt-library", icon: BookOpen }
```

A rota `/prompt-library` permanece a mesma — só o label muda. O `SalomaoStudio` é removido da página, mantendo apenas os templates por nicho e a aba "Meus Prompts".

---

## 10. Edge Cases

| Situação | Comportamento |
|---|---|
| Stream cai no meio | Evento `error` → botão "Tentar novamente" no drawer |
| Drawer fechado durante streaming | `AbortController.abort()` cancela o fetch |
| Org sem API key | Mensagem clara antes de iniciar (verificação prévia) |
| Prompt gigante (>1500 tokens) | `max_tokens: 1500` no OpenAI já limita |
| Auditor reprova o prompt | Evento `error` com mensagem descritiva ao usuário |
| Rede lenta / timeout | Timeout de 60s no fetch SSE → evento `error` |
| Drawer reaberto após erro | Estado reseta para `idle`, Salomão reinicia |

---

## 11. Plano de Rollout — 4 PRs Independentes

| PR | Escopo | Risco | Dependência |
|---|---|---|---|
| 1 | Endpoint SSE + tabela `salomao_config` | Baixo — aditivo | nenhuma |
| 2 | `SalomaoDrawer` + `use-salomao-stream` + integração em `/agents` | Médio — nova UI | PR 1 |
| 3 | Remover `SalomaoStudio` da prompt-library + rename nav | Baixo — remoção | PR 2 em prod |
| 4 | Seção Admin do Salomão no painel-gestor | Baixo — isolado | PR 1 |

### Anti-regressão

- PR 1 não toca frontend → zero risco UX
- PR 2 só adiciona o drawer; botão "Criar Agente" atual continua funcionando em paralelo
- PR 3 só remove código após PR 2 estar estável em prod
- Testes existentes de `/prompt-studio` continuam passando (endpoint antigo preservado)
- `SalomaoStudio` removido apenas após `SalomaoDrawer` validado

---

## 12. Checklist de Produção

- [ ] Endpoint SSE funciona com Fastify (`reply.raw` + `res.write`)
- [ ] `AbortController` cancela stream quando drawer fecha
- [ ] Foco do input persiste após cada envio
- [ ] Textarea do drawer e do AgentForm se auto-expandem
- [ ] Botão "Usar este prompt" navega para `/agents/new?prompt=...` com prompt codificado
- [ ] `AgentForm` lê `?prompt` da URL e preenche `system_prompt`
- [ ] Sidebar mostra "Biblioteca de Agentes"
- [ ] Admin no painel-gestor lê/salva `salomao_config`
- [ ] API lê system prompt da tabela (não hardcoded)
- [ ] Auditor ainda valida o prompt gerado no fluxo SSE
- [ ] Edge cases de erro mostram UI amigável no drawer
- [ ] Testes de `/prompt-studio/chat` (POST antigo) continuam passando
