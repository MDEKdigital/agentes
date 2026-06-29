# Agent Restructure — Salomão Drawer + SSE + Biblioteca de Agentes

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mover Salomão para um drawer na área de agentes com streaming SSE real, input persistente, textareas auto-expansivos, renomear Biblioteca de Prompts e adicionar admin do Salomão no painel-gestor.

**Architecture:** O backend ganha um novo endpoint SSE (`POST /chat/stream`) que lê o system prompt da tabela `salomao_config` e faz pipe do stream da OpenAI para o cliente via eventos `chunk | prompt | done | error`. O frontend ganha um hook `use-salomao-stream` e um componente `SalomaoDrawer` que abre dentro da página `/agents` como drawer lateral, substituindo completamente o `SalomaoStudio` da prompt-library.

**Tech Stack:** Fastify SSE via `reply.hijack()` + `reply.raw`, `fetch` nativo com `stream: true`, React hooks com `ReadableStream`, Vitest para testes, SQL para migration.

## Global Constraints

- Vitest como test runner em todos os pacotes (`pnpm test` em `apps/api` ou `apps/web`)
- Endpoint antigo `POST /organizations/:orgId/prompt-studio/chat` deve permanecer intacto
- Sem quebrar testes existentes de `/prompt-studio`
- Migrations em `apps/api/migrations/*.sql` com prefixo numérico crescente (ex: `0001_`, `0002_`)
- TypeScript strict — sem `any` implícito
- `reply.hijack()` obrigatório para SSE no Fastify — não usar `reply.send()` depois
- Botão "Criar Agente" em `/agents` deve abrir o drawer (não navegar para `/agents/new`)
- `/agents/new` continua funcionando para quem chega com `?prompt=` na URL
- `AbortController` deve cancelar o fetch SSE quando o drawer fechar

---

## Mapa de Arquivos

| Ação | Arquivo |
|---|---|
| Criar | `apps/api/migrations/0001_salomao_config.sql` |
| Criar | `apps/api/src/routes/prompt-studio/__tests__/stream.test.ts` |
| Modificar | `apps/api/src/routes/prompt-studio/index.ts` |
| Criar | `apps/api/src/routes/admin/__tests__/salomao-config.test.ts` |
| Modificar | `apps/api/src/routes/admin/index.ts` |
| Criar | `apps/web/src/hooks/use-salomao-stream.ts` |
| Criar | `apps/web/src/components/agents/salomao-drawer.tsx` |
| Modificar | `apps/web/src/app/(dashboard)/agents/page.tsx` |
| Modificar | `apps/web/src/app/(dashboard)/agents/new/page.tsx` |
| Modificar | `apps/web/src/components/agents/agent-form.tsx` |
| Modificar | `apps/web/src/app/(dashboard)/prompt-library/page.tsx` |
| Modificar | `apps/web/src/components/layout/app-sidebar.tsx` |
| Modificar | `apps/web/src/app/(dashboard)/painel-gestor/page.tsx` |

---

## Task 1: Migration + Endpoint SSE (Backend)

**Files:**
- Create: `apps/api/migrations/0001_salomao_config.sql`
- Create: `apps/api/src/routes/prompt-studio/__tests__/stream.test.ts`
- Modify: `apps/api/src/routes/prompt-studio/index.ts`

**Interfaces:**
- Produz: `POST /organizations/:orgId/prompt-studio/chat/stream` (SSE)
- Produz: `resolveSystemPrompt(): Promise<string>` (lê `salomao_config` do DB)
- Produz: eventos SSE: `{type:"chunk",content:string}` | `{type:"prompt",content:string}` | `{type:"done"}` | `{type:"error",message:string}`

- [ ] **Step 1: Criar diretório de migrations e arquivo SQL**

Criar `apps/api/migrations/0001_salomao_config.sql`:

```sql
CREATE TABLE IF NOT EXISTS salomao_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  system_prompt text NOT NULL,
  updated_at timestamptz DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);

INSERT INTO salomao_config (system_prompt)
SELECT $prompt$Você é Salomão, Consultor Oficial de Prompts do Projeto Agentes — o especialista em criar prompts de alta performance para agentes de IA.

Seu papel agora é guiar o usuário na criação de um prompt completo e eficaz para o agente dele, fazendo perguntas estratégicas sobre o negócio.

COMPORTAMENTO:
- Faça APENAS UMA pergunta por vez
- Aguarde a resposta antes de avançar
- Adapte as próximas perguntas com base nas respostas anteriores
- Seja objetivo, direto e empolgante — você é o melhor nisso
- Use linguagem natural, não robótica
- Valide as respostas positivamente antes de avançar

PERGUNTAS A COBRIR (adapte a ordem conforme a conversa):
1. Nome do negócio e nicho de atuação
2. Público-alvo principal (quem compra/contrata)
3. Produtos ou serviços principais (e diferenciais)
4. Tom de comunicação desejado (formal, casual, técnico, amigável, etc.)
5. O que o agente vai fazer no dia a dia (responder dúvidas, fechar vendas, agendar, etc.)
6. O que o agente JAMAIS deve dizer ou fazer (limites, restrições)
7. Há alguma informação crítica que o agente precisa saber sempre? (preços, políticas, horários)
8. Como o agente deve se chamar?

QUANDO TIVER INFORMAÇÃO SUFICIENTE (após cobrir os pontos principais):
- Avise que vai gerar o prompt agora
- Gere um prompt completo, detalhado e profissional
- Entregue o prompt DENTRO das tags <prompt> e </prompt>
- Após as tags, pergunte se o usuário quer ajustar algo

REGRAS:
- Nunca invente informações sobre o negócio do usuário
- Nunca pule etapas sem perguntar
- O prompt gerado deve seguir as regras globais do Projeto Agentes
- O prompt deve ter: identidade do agente, objetivo, tom, regras, limites e formato de resposta$prompt$
WHERE NOT EXISTS (SELECT 1 FROM salomao_config);
```

- [ ] **Step 2: Escrever teste de falha para o endpoint SSE**

Criar `apps/api/src/routes/prompt-studio/__tests__/stream.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";

const { mockAuthMiddleware, mockGetAdminClient, mockResolveKey } = vi.hoisted(() => ({
  mockAuthMiddleware: vi.fn(),
  mockGetAdminClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue({ data: null }) })),
          maybeSingle: vi.fn().mockResolvedValue({ data: null }),
          single: vi.fn().mockResolvedValue({ data: { system_prompt: "mocked prompt" }, error: null }),
          limit: vi.fn(() => ({ single: vi.fn().mockResolvedValue({ data: { system_prompt: "mocked prompt" }, error: null }) })),
        })),
      })),
    })),
  })),
  mockResolveKey: vi.fn().mockResolvedValue("sk-test"),
}));

vi.mock("../../../middleware/auth", () => ({ authMiddleware: mockAuthMiddleware }));
vi.mock("@aula-agente/database", () => ({ getAdminClient: mockGetAdminClient }));
vi.mock("../../../lib/crypto", () => ({ decrypt: vi.fn((v: string) => v) }));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import promptStudioRoutes from "../index";

function buildApp() {
  const app = Fastify();
  mockAuthMiddleware.mockImplementation(async (req: { user: { id: string; memberships: { organization_id: string; role: string }[] } }) => {
    req.user = { id: "user-1", memberships: [{ organization_id: "org-1", role: "owner" }] };
  });
  app.register(promptStudioRoutes);
  return app;
}

describe("POST /organizations/:orgId/prompt-studio/chat/stream", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects missing messages body", async () => {
    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/organizations/org-1/prompt-studio/chat/stream",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects unknown org", async () => {
    const app = buildApp();
    mockAuthMiddleware.mockImplementationOnce(async (req: { user: { id: string; memberships: never[] } }) => {
      req.user = { id: "user-1", memberships: [] };
    });
    const res = await app.inject({
      method: "POST",
      url: "/organizations/other-org/prompt-studio/chat/stream",
      payload: { messages: [] },
    });
    expect(res.statusCode).toBe(403);
  });

  it("streams SSE events when OpenAI responds", async () => {
    const sseChunk = (obj: object) =>
      new TextEncoder().encode(`data: ${JSON.stringify(obj)}\n\n`);

    const chunks = [
      `data: ${JSON.stringify({ choices: [{ delta: { content: "Olá" }, finish_reason: null }] })}\n\n`,
      `data: [DONE]\n\n`,
    ];
    let chunkIndex = 0;

    const mockStream = {
      [Symbol.asyncIterator]() {
        return {
          next: async () => {
            if (chunkIndex < chunks.length) {
              return { value: new TextEncoder().encode(chunks[chunkIndex++]), done: false };
            }
            return { value: undefined, done: true };
          },
        };
      },
    };

    mockFetch.mockResolvedValueOnce({ ok: true, body: mockStream });

    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/organizations/org-1/prompt-studio/chat/stream",
      payload: { messages: [{ role: "user", content: "oi" }] },
    });

    expect(res.headers["content-type"]).toContain("text/event-stream");
    expect(res.body).toContain('"type":"chunk"');
    expect(res.body).toContain('"type":"done"');
  });
});
```

- [ ] **Step 3: Rodar o teste para confirmar que falha**

```bash
cd apps/api && pnpm test src/routes/prompt-studio/__tests__/stream.test.ts
```

Esperado: FAIL — `promptStudioRoutes` não tem rota `/chat/stream`.

- [ ] **Step 4: Implementar o endpoint SSE em `apps/api/src/routes/prompt-studio/index.ts`**

Adicionar as seguintes importações no topo do arquivo (após os imports existentes):

```ts
import { Agent } from "undici";
```

Adicionar a função `resolveSystemPrompt` antes de `promptStudioRoutes`:

```ts
async function resolveSystemPrompt(): Promise<string> {
  const db = getAdminClient();
  const { data } = await db
    .from("salomao_config")
    .select("system_prompt")
    .limit(1)
    .single();
  return data?.system_prompt ?? SALOMAO_SYSTEM_PROMPT;
}
```

Adicionar o endpoint SSE dentro de `promptStudioRoutes`, após o endpoint `POST /chat` existente:

```ts
// Streaming endpoint — SSE
app.post<{ Params: { organizationId: string } }>(
  "/organizations/:organizationId/prompt-studio/chat/stream",
  async (request, reply) => {
    const { organizationId } = request.params;
    const membership = request.user.memberships.find(
      (m) => m.organization_id === organizationId
    );
    if (!membership) return reply.status(403).send({ error: "Acesso negado" });

    const { messages } = request.body as { messages: { role: string; content: string }[] };
    if (!Array.isArray(messages)) return reply.status(400).send({ error: "Mensagens obrigatórias" });

    const [apiKey, systemPrompt] = await Promise.all([
      resolveOrgOpenAIKey(organizationId),
      resolveSystemPrompt(),
    ]);

    // Hijack response — Fastify não deve finalizar
    reply.hijack();
    const raw = reply.raw;
    raw.setHeader("Content-Type", "text/event-stream");
    raw.setHeader("Cache-Control", "no-cache");
    raw.setHeader("Connection", "keep-alive");
    raw.setHeader("X-Accel-Buffering", "no");
    raw.flushHeaders();

    const sendEvent = (data: object) => {
      try { raw.write(`data: ${JSON.stringify(data)}\n\n`); } catch { /* client disconnected */ }
    };

    try {
      // Bypass global undici bodyTimeout para streaming longo
      const streamAgent = new Agent({ headersTimeout: 15_000, bodyTimeout: 0 });

      const res = await (fetch as (url: string, init?: RequestInit & { dispatcher?: unknown }) => Promise<Response>)(
        "https://api.openai.com/v1/chat/completions",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model: "gpt-4.1-nano",
            messages: [
              { role: "system", content: systemPrompt },
              ...messages,
            ],
            max_tokens: 1500,
            temperature: 0.7,
            stream: true,
          }),
          dispatcher: streamAgent,
        } as RequestInit & { dispatcher?: unknown }
      );

      if (!res.ok || !res.body) {
        sendEvent({ type: "error", message: "Erro ao chamar IA" });
        raw.end();
        return;
      }

      const decoder = new TextDecoder();
      let accumulated = "";
      let promptSent = false;

      for await (const chunk of res.body as AsyncIterable<Uint8Array>) {
        const text = decoder.decode(chunk, { stream: true });
        const lines = text.split("\n");

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") continue;

          try {
            const parsed = JSON.parse(data) as {
              choices: { delta: { content?: string }; finish_reason?: string }[];
            };
            const content = parsed.choices?.[0]?.delta?.content ?? "";
            if (!content) continue;

            accumulated += content;
            sendEvent({ type: "chunk", content });

            // Detecta prompt completo e valida
            if (!promptSent) {
              const match = accumulated.match(/<prompt>([\s\S]*?)<\/prompt>/i);
              if (match) {
                const extractedPrompt = match[1].trim();
                const validation = await validateGeneratedPrompt(extractedPrompt, apiKey);
                if (!validation.compliant) {
                  sendEvent({
                    type: "error",
                    message: `Prompt não passou na validação: ${validation.violation ?? "violação detectada"}`,
                  });
                } else {
                  sendEvent({ type: "prompt", content: extractedPrompt });
                }
                promptSent = true;
              }
            }
          } catch {
            // Ignora chunks malformados
          }
        }
      }

      sendEvent({ type: "done" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      sendEvent({ type: "error", message: msg });
    } finally {
      raw.end();
    }
  }
);
```

- [ ] **Step 5: Rodar o teste para confirmar que passa**

```bash
cd apps/api && pnpm test src/routes/prompt-studio/__tests__/stream.test.ts
```

Esperado: PASS — 3 testes passam.

- [ ] **Step 6: Rodar todos os testes da prompt-studio para garantir sem regressão**

```bash
cd apps/api && pnpm test src/routes/prompt-studio/
```

Esperado: todos passam.

- [ ] **Step 7: Commit**

```bash
git add apps/api/migrations/0001_salomao_config.sql \
        apps/api/src/routes/prompt-studio/index.ts \
        apps/api/src/routes/prompt-studio/__tests__/stream.test.ts
git commit -m "feat(api): endpoint SSE /chat/stream + tabela salomao_config"
```

---

## Task 2: Hook `use-salomao-stream` (Frontend)

**Files:**
- Create: `apps/web/src/hooks/use-salomao-stream.ts`

**Interfaces:**
- Consome: `POST /organizations/:orgId/prompt-studio/chat/stream` da Task 1
- Produz: `useSalomaoStream({ organizationId, onChunk, onPromptReady, onDone, onError })` → `{ state, send, abort }`
  - `state: 'idle' | 'connecting' | 'streaming' | 'done' | 'error'`
  - `send(messages: ChatMessage[]): Promise<void>`
  - `abort(): void`
- Produz: tipo `ChatMessage = { role: 'user' | 'assistant'; content: string }`

- [ ] **Step 1: Criar o arquivo do hook**

Criar `apps/web/src/hooks/use-salomao-stream.ts`:

```ts
"use client";

import { useState, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export type StreamState = "idle" | "connecting" | "streaming" | "done" | "error";

interface StreamEvent {
  type: "chunk" | "prompt" | "done" | "error";
  content?: string;
  message?: string;
}

interface UseSalomaoStreamOptions {
  organizationId: string | undefined;
  onChunk: (text: string) => void;
  onPromptReady: (prompt: string) => void;
  onDone: () => void;
  onError: (message: string) => void;
}

export function useSalomaoStream({
  organizationId,
  onChunk,
  onPromptReady,
  onDone,
  onError,
}: UseSalomaoStreamOptions) {
  const [state, setState] = useState<StreamState>("idle");
  const abortRef = useRef<AbortController | null>(null);
  const apiBase = process.env.NEXT_PUBLIC_API_URL;

  const send = useCallback(
    async (messages: ChatMessage[]) => {
      if (!organizationId) return;

      abortRef.current?.abort();
      abortRef.current = new AbortController();

      setState("connecting");

      try {
        const supabase = createClient();
        const {
          data: { session },
        } = await supabase.auth.getSession();

        const res = await fetch(
          `${apiBase}/organizations/${organizationId}/prompt-studio/chat/stream`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${session?.access_token ?? ""}`,
            },
            body: JSON.stringify({ messages }),
            signal: abortRef.current.signal,
          }
        );

        if (!res.ok || !res.body) {
          setState("error");
          onError("Erro ao conectar com Salomão");
          return;
        }

        setState("streaming");

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6).trim();
            if (!data) continue;

            try {
              const event = JSON.parse(data) as StreamEvent;
              if (event.type === "chunk" && event.content) {
                onChunk(event.content);
              } else if (event.type === "prompt" && event.content) {
                onPromptReady(event.content);
              } else if (event.type === "done") {
                setState("done");
                onDone();
              } else if (event.type === "error") {
                setState("error");
                onError(event.message ?? "Erro desconhecido");
              }
            } catch {
              // Ignora linhas malformadas
            }
          }
        }
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setState("error");
        onError("Conexão interrompida");
      }
    },
    [organizationId, apiBase, onChunk, onPromptReady, onDone, onError]
  );

  const abort = useCallback(() => {
    abortRef.current?.abort();
    setState("idle");
  }, []);

  return { state, send, abort };
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/hooks/use-salomao-stream.ts
git commit -m "feat(web): hook use-salomao-stream com SSE e AbortController"
```

---

## Task 3: SalomaoDrawer + Integração na Página de Agentes

**Files:**
- Create: `apps/web/src/components/agents/salomao-drawer.tsx`
- Modify: `apps/web/src/app/(dashboard)/agents/page.tsx`
- Modify: `apps/web/src/app/(dashboard)/agents/new/page.tsx`
- Modify: `apps/web/src/components/agents/agent-form.tsx`

**Interfaces:**
- Consome: `useSalomaoStream` da Task 2
- Consome: `ChatMessage` da Task 2
- Produz: `<SalomaoDrawer isOpen onClose />` — componente React

- [ ] **Step 1: Criar `salomao-drawer.tsx`**

Criar `apps/web/src/components/agents/salomao-drawer.tsx`:

```tsx
"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { X, Send, Sparkles, Copy, Check, ArrowRight, Loader2, AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useOrganization } from "@/providers/organization-provider";
import { useSalomaoStream, type ChatMessage } from "@/hooks/use-salomao-stream";

interface SalomaoDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

function TypingIndicator() {
  return (
    <div className="flex justify-start">
      <div className="bg-muted rounded-2xl rounded-bl-sm px-4 py-3 flex gap-1.5">
        <span className="h-2 w-2 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:0ms]" />
        <span className="h-2 w-2 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:150ms]" />
        <span className="h-2 w-2 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:300ms]" />
      </div>
    </div>
  );
}

export function SalomaoDrawer({ isOpen, onClose }: SalomaoDrawerProps) {
  const router = useRouter();
  const { currentOrg } = useOrganization();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamingContent, setStreamingContent] = useState("");
  const [generatedPrompt, setGeneratedPrompt] = useState("");
  const [copied, setCopied] = useState(false);
  const [input, setInput] = useState("");
  const [initialized, setInitialized] = useState(false);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  // Auto-expand textarea
  function autoResize(el: HTMLTextAreaElement) {
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }

  const onChunk = useCallback((text: string) => {
    setStreamingContent((prev) => prev + text);
  }, []);

  const onPromptReady = useCallback((prompt: string) => {
    setGeneratedPrompt(prompt);
  }, []);

  const onDone = useCallback(() => {
    setStreamingContent((prev) => {
      if (prev) {
        const display = prev
          .replace(/<prompt>[\s\S]*?<\/prompt>/gi, "✅ Prompt gerado! Veja ao lado →")
          .trim();
        setMessages((m) => [...m, { role: "assistant", content: display }]);
      }
      return "";
    });
    // Restore focus after streaming
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  const onError = useCallback((message: string) => {
    setStreamingContent("");
    setMessages((m) => [
      ...m,
      { role: "assistant", content: `⚠️ ${message}` },
    ]);
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  const { state, send, abort } = useSalomaoStream({
    organizationId: currentOrg?.id,
    onChunk,
    onPromptReady,
    onDone,
    onError,
  });

  const isStreaming = state === "connecting" || state === "streaming";

  // Init: Salomão abre a conversa
  useEffect(() => {
    if (!isOpen || initialized || !currentOrg) return;
    setInitialized(true);
    send([]);
  }, [isOpen, initialized, currentOrg, send]);

  // Limpar ao fechar
  useEffect(() => {
    if (!isOpen) {
      abort();
      setMessages([]);
      setStreamingContent("");
      setGeneratedPrompt("");
      setInput("");
      setInitialized(false);
    }
  }, [isOpen, abort]);

  async function handleSend(text?: string) {
    const msg = (text ?? input).trim();
    if (!msg || isStreaming) return;

    setInput("");
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
    }

    const newMessages: ChatMessage[] = [...messages, { role: "user", content: msg }];
    setMessages(newMessages);
    setStreamingContent("");

    await send(newMessages);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  async function copyPrompt() {
    if (!generatedPrompt) return;
    await navigator.clipboard.writeText(generatedPrompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function useAsPrompt() {
    if (!generatedPrompt) return;
    onClose();
    router.push(`/agents/new?prompt=${encodeURIComponent(generatedPrompt)}`);
  }

  // Display: mensagens completas + streaming atual
  const displayStreamingContent =
    streamingContent
      .replace(/<prompt>[\s\S]*?<\/prompt>/gi, "✅ Prompt gerado! Veja ao lado →")
      .trim();

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-background/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-3xl flex-col bg-card shadow-2xl border-l border-border">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-border px-4 py-3 bg-muted/30 shrink-0">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary font-bold text-sm">
            S
          </div>
          <div>
            <p className="font-semibold text-sm">Salomão</p>
            <p className="text-[11px] text-muted-foreground">Consultor Oficial de Agentes</p>
          </div>
          <Button variant="ghost" size="icon" className="ml-auto h-8 w-8" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Body: Chat + Preview */}
        <div className="flex flex-1 overflow-hidden">
          {/* Chat */}
          <div className="flex flex-col flex-1 min-w-0 border-r border-border">
            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
              {messages.map((m, i) => (
                <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                      m.role === "user"
                        ? "bg-primary text-primary-foreground rounded-br-sm"
                        : "bg-muted text-foreground rounded-bl-sm"
                    }`}
                  >
                    {m.content}
                  </div>
                </div>
              ))}

              {/* Streaming atual */}
              {displayStreamingContent && (
                <div className="flex justify-start">
                  <div className="max-w-[85%] rounded-2xl rounded-bl-sm px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap bg-muted text-foreground">
                    {displayStreamingContent}
                  </div>
                </div>
              )}

              {isStreaming && !displayStreamingContent && <TypingIndicator />}

              {state === "error" && messages.length === 0 && (
                <div className="flex flex-col items-center gap-3 py-8 text-center">
                  <AlertCircle className="h-8 w-8 text-destructive" />
                  <p className="text-sm text-muted-foreground">Erro ao conectar. Tente novamente.</p>
                  <Button variant="outline" size="sm" onClick={() => { setInitialized(false); }}>
                    <RefreshCw className="h-4 w-4 mr-2" />Reconectar
                  </Button>
                </div>
              )}

              <div ref={chatEndRef} />
            </div>

            {/* Input */}
            <div className="shrink-0 border-t border-border p-3 flex gap-2 items-end">
              <textarea
                ref={inputRef}
                rows={1}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  autoResize(e.target);
                }}
                onKeyDown={handleKeyDown}
                disabled={isStreaming}
                placeholder={isStreaming ? "Salomão está digitando..." : "Responda Salomão... (Enter para enviar)"}
                className="flex-1 resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50 overflow-y-auto"
                style={{ minHeight: "38px", maxHeight: "200px" }}
              />
              <Button
                size="icon"
                className="h-9 w-9 shrink-0"
                onClick={() => handleSend()}
                disabled={!input.trim() || isStreaming}
              >
                {isStreaming ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>

          {/* Preview do Prompt */}
          <div className="w-[45%] shrink-0 flex flex-col">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-muted/30 shrink-0">
              <Sparkles className="h-4 w-4 text-primary" />
              <p className="font-semibold text-sm">Prompt gerado</p>
            </div>

            {generatedPrompt ? (
              <div className="flex flex-col flex-1 overflow-hidden p-4 gap-3">
                <textarea
                  readOnly
                  value={generatedPrompt}
                  className="flex-1 resize-none rounded-md border border-border bg-muted/40 p-3 text-xs font-mono text-foreground overflow-y-auto focus:outline-none"
                />
                <div className="flex flex-col gap-2 shrink-0">
                  <Button variant="outline" onClick={copyPrompt} className="w-full">
                    {copied ? (
                      <><Check className="h-4 w-4 mr-2 text-green-500" />Copiado!</>
                    ) : (
                      <><Copy className="h-4 w-4 mr-2" />Copiar prompt</>
                    )}
                  </Button>
                  <Button onClick={useAsPrompt} className="w-full">
                    <ArrowRight className="h-4 w-4 mr-2" />
                    Usar este prompt
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6 text-center">
                <Sparkles className="h-10 w-10 text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground">
                  Responda as perguntas do Salomão e o prompt do seu agente aparecerá aqui automaticamente.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 2: Integrar SalomaoDrawer na página de agentes**

Modificar `apps/web/src/app/(dashboard)/agents/page.tsx`.

Adicionar import no topo (após os imports existentes):

```tsx
import { useState } from "react";
import { SalomaoDrawer } from "@/components/agents/salomao-drawer";
```

Dentro do componente `AgentsPage`, adicionar estado e substituir o botão "Novo Agente":

```tsx
// Adicionar após os useState existentes:
const [drawerOpen, setDrawerOpen] = useState(false);
```

Substituir:
```tsx
<Link href="/agents/new">
  <button className="flex items-center gap-2 rounded-lg bg-amber-fire-500 px-4 py-2 text-sm font-semibold text-[#0F1219] transition-colors hover:bg-amber-fire-400">
    <Plus className="h-4 w-4" />
    Novo Agente
  </button>
</Link>
```

Por:
```tsx
<button
  onClick={() => setDrawerOpen(true)}
  className="flex items-center gap-2 rounded-lg bg-amber-fire-500 px-4 py-2 text-sm font-semibold text-[#0F1219] transition-colors hover:bg-amber-fire-400"
>
  <Plus className="h-4 w-4" />
  Criar Agente
</button>
```

Substituir o card de "Novo Agente" no grid (Link para /agents/new) por:
```tsx
<div
  onClick={() => setDrawerOpen(true)}
  className="flex h-full min-h-[160px] flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border transition-all hover:border-primary/40 hover:bg-primary/5 cursor-pointer"
>
  <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-dashed border-border">
    <Plus className="h-4 w-4 text-muted-foreground" />
  </div>
  <p className="text-sm font-medium text-muted-foreground">Criar Agente</p>
</div>
```

Substituir o botão "Criar Agente" no empty state (Link para /agents/new):
```tsx
<button
  onClick={() => setDrawerOpen(true)}
  className="flex items-center gap-2 rounded-lg bg-amber-fire-500 px-4 py-2 text-sm font-semibold text-[#0F1219] transition-colors hover:bg-amber-fire-400"
>
  <Plus className="h-4 w-4" />
  Criar Agente
</button>
```

Adicionar antes do `return` final (ou logo antes do fechamento do `<div className="space-y-6">`):
```tsx
<SalomaoDrawer isOpen={drawerOpen} onClose={() => setDrawerOpen(false)} />
```

Remover todos os `import Link from "next/link"` que ficaram sem uso após as substituições (verifique se `Link` ainda é usado em outro lugar na página — se não for, remova o import).

- [ ] **Step 3: Fazer `/agents/new` ler o param `?prompt` da URL**

Substituir o conteúdo de `apps/web/src/app/(dashboard)/agents/new/page.tsx` por:

```tsx
"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useOrganization } from "@/providers/organization-provider";
import { apiFetch } from "@/lib/api";
import { AgentForm } from "@/components/agents/agent-form";

function NewAgentForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { currentOrg } = useOrganization();
  const [error, setError] = useState<string | null>(null);

  const promptFromUrl = searchParams.get("prompt") ?? "";

  const handleSubmit = async (values: Record<string, unknown>) => {
    if (!currentOrg) return;
    setError(null);

    try {
      await apiFetch(`/organizations/${currentOrg.id}/agents`, {
        method: "POST",
        body: JSON.stringify(values),
      });
      router.push("/agents");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao criar agente");
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold">Novo Agente</h1>
      {error && (
        <p className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      )}
      <AgentForm
        defaultValues={{ system_prompt: promptFromUrl }}
        onSubmit={handleSubmit}
        submitLabel="Criar Agente"
      />
    </div>
  );
}

export default function NewAgentPage() {
  return (
    <Suspense>
      <NewAgentForm />
    </Suspense>
  );
}
```

- [ ] **Step 4: Adicionar auto-expand no textarea `system_prompt` do AgentForm**

Em `apps/web/src/components/agents/agent-form.tsx`, localizar o campo `system_prompt`. Ele usa um `<Textarea>` com `rows={...}` fixo. Substituir pelo padrão auto-expansivo.

Localizar o bloco do system_prompt (procurar por `system_prompt` no arquivo). Adicionar `ref` e `onInput` ao Textarea:

```tsx
// Adicionar import useRef:
import { useState, useRef } from "react";

// Dentro do componente AgentForm, adicionar:
const systemPromptRef = useRef<HTMLTextAreaElement>(null);

function autoResizeSystemPrompt() {
  const el = systemPromptRef.current;
  if (!el) return;
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 600) + "px";
}
```

No campo do system_prompt, adicionar `ref={systemPromptRef}` e `onInput={autoResizeSystemPrompt}` ao `<Textarea>`, e remover o `rows` fixo se existir. O campo deve ficar com `style={{ minHeight: "200px", maxHeight: "600px" }}`.

- [ ] **Step 5: Verificar que o build do web não tem erros de TypeScript**

```bash
cd apps/web && pnpm tsc --noEmit
```

Esperado: sem erros.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/agents/salomao-drawer.tsx \
        apps/web/src/app/(dashboard)/agents/page.tsx \
        apps/web/src/app/(dashboard)/agents/new/page.tsx \
        apps/web/src/components/agents/agent-form.tsx
git commit -m "feat(web): SalomaoDrawer com SSE, foco persistente e auto-expand"
```

---

## Task 4: Limpar Prompt-Library + Renomear Nav

**Files:**
- Modify: `apps/web/src/app/(dashboard)/prompt-library/page.tsx`
- Modify: `apps/web/src/components/layout/app-sidebar.tsx`

**Interfaces:**
- Consome: nada novo
- Produz: nav item renomeado para "Biblioteca de Agentes"; SalomaoStudio removido da página

- [ ] **Step 1: Renomear item na sidebar**

Em `apps/web/src/components/layout/app-sidebar.tsx`, localizar:

```ts
{ name: "Biblioteca de Prompts", href: "/prompt-library", icon: BookOpen },
```

Substituir por:

```ts
{ name: "Biblioteca de Agentes", href: "/prompt-library", icon: BookOpen },
```

- [ ] **Step 2: Remover SalomaoStudio da prompt-library**

Em `apps/web/src/app/(dashboard)/prompt-library/page.tsx`:

1. Remover a função `SalomaoStudio` inteira (linhas 170–376)
2. Remover os estados relacionados ao studio: `studioOpen`, `localSaved`, `usePromptStudio` (o hook salvo para `savedPrompts` ainda é necessário)
3. Remover o botão "Crie seu Prompt" no header
4. Remover o bloco `{studioOpen && (...)}` do JSX
5. Remover os imports não usados: `Mic`, `MicOff`, `Send`, `Sparkles`, `Save`, `Loader2`, `X`, `useRouter`, `usePromptStudio` (se não mais usado), `type ChatMessage`
6. Atualizar o `<h1>` de "Biblioteca de Prompts" para "Biblioteca de Agentes"
7. Atualizar o `<p>` subtitle para: "Templates prontos por nicho para usar como base no seu agente."

O resultado final deve manter apenas:
- O header com o título atualizado (sem botão "Crie seu Prompt")
- A aba "Templates" com os filtros por nicho e grid de cards
- A aba "Meus Prompts" com os prompts salvos (mantém CRUD)
- Os dialogs de detalhe, edição e exclusão de prompts

- [ ] **Step 3: Verificar TypeScript**

```bash
cd apps/web && pnpm tsc --noEmit
```

Esperado: sem erros.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/layout/app-sidebar.tsx \
        apps/web/src/app/(dashboard)/prompt-library/page.tsx
git commit -m "feat(web): renomear Biblioteca de Agentes e remover SalomaoStudio da prompt-library"
```

---

## Task 5: Admin do Salomão no Painel-Gestor

**Files:**
- Create: `apps/api/src/routes/admin/__tests__/salomao-config.test.ts`
- Modify: `apps/api/src/routes/admin/index.ts`
- Modify: `apps/web/src/app/(dashboard)/painel-gestor/page.tsx`

**Interfaces:**
- Produz: `GET /admin/salomao-config` → `{ system_prompt: string; updated_at: string }`
- Produz: `PATCH /admin/salomao-config` body `{ system_prompt: string }` → `{ system_prompt: string; updated_at: string }`
- Consome: autenticação super-admin (middleware já existente: `superAdminMiddleware`)

- [ ] **Step 1: Escrever testes para os endpoints admin salomao-config**

Criar `apps/api/src/routes/admin/__tests__/salomao-config.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";

const { mockAuthMiddleware, mockSuperAdminMiddleware, mockGetAdminClient } = vi.hoisted(() => ({
  mockAuthMiddleware: vi.fn(),
  mockSuperAdminMiddleware: vi.fn(),
  mockGetAdminClient: vi.fn(),
}));

vi.mock("../../../middleware/auth", () => ({ authMiddleware: mockAuthMiddleware }));
vi.mock("../../../middleware/super-admin", () => ({ superAdminMiddleware: mockSuperAdminMiddleware }));
vi.mock("@aula-agente/database", () => ({ getAdminClient: mockGetAdminClient }));
vi.mock("../../../lib/email", () => ({ sendWelcomeEmailApi: vi.fn() }));
vi.mock("../../../lib/audit", () => ({ fireAudit: vi.fn() }));
vi.mock("../../../lib/crypto", () => ({ encrypt: vi.fn((v: string) => v), decrypt: vi.fn((v: string) => v) }));

import adminRoutes from "../index";

function buildApp() {
  const app = Fastify();
  mockAuthMiddleware.mockImplementation(async (req: { user: { id: string; memberships: never[] } }) => {
    req.user = { id: "super-1", memberships: [] };
  });
  mockSuperAdminMiddleware.mockImplementation(async () => {});
  app.register(adminRoutes);
  return app;
}

describe("GET /admin/salomao-config", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns system_prompt from DB", async () => {
    mockGetAdminClient.mockReturnValue({
      from: () => ({
        select: () => ({ limit: () => ({ single: async () => ({ data: { system_prompt: "prompt test", updated_at: "2026-01-01" }, error: null }) }) }),
        update: vi.fn(),
      }),
    });

    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/admin/salomao-config" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.system_prompt).toBe("prompt test");
  });
});

describe("PATCH /admin/salomao-config", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects empty system_prompt", async () => {
    const app = buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: "/admin/salomao-config",
      payload: { system_prompt: "   " },
    });
    expect(res.statusCode).toBe(400);
  });

  it("updates system_prompt and returns updated row", async () => {
    const updatedRow = { system_prompt: "novo prompt", updated_at: "2026-06-28" };
    mockGetAdminClient.mockReturnValue({
      from: () => ({
        update: () => ({ select: () => ({ single: async () => ({ data: updatedRow, error: null }) }) }),
      }),
    });

    const app = buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: "/admin/salomao-config",
      payload: { system_prompt: "novo prompt" },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).system_prompt).toBe("novo prompt");
  });
});
```

- [ ] **Step 2: Rodar testes para confirmar falha**

```bash
cd apps/api && pnpm test src/routes/admin/__tests__/salomao-config.test.ts
```

Esperado: FAIL — rotas não existem ainda.

- [ ] **Step 3: Adicionar endpoints em `apps/api/src/routes/admin/index.ts`**

Adicionar no final de `adminRoutes`, antes do fechamento da função:

```ts
// GET /admin/salomao-config
app.get("/admin/salomao-config", async (request, reply) => {
  const db = getAdminClient();
  const { data, error } = await db
    .from("salomao_config")
    .select("system_prompt, updated_at")
    .limit(1)
    .single();
  if (error || !data) return reply.status(404).send({ error: "Configuração não encontrada." });
  return reply.send(data);
});

// PATCH /admin/salomao-config
app.patch("/admin/salomao-config", async (request, reply) => {
  const body = request.body as Record<string, unknown> | null | undefined;
  const systemPrompt = typeof body?.system_prompt === "string" ? body.system_prompt.trim() : "";
  if (!systemPrompt) return reply.status(400).send({ error: "system_prompt obrigatório e não pode ser vazio." });

  const db = getAdminClient();
  const { data, error } = await db
    .from("salomao_config")
    .update({ system_prompt: systemPrompt, updated_at: new Date().toISOString(), updated_by: request.user.id })
    .select("system_prompt, updated_at")
    .single();
  if (error) {
    request.log.error({ error }, "admin: failed to update salomao_config");
    return reply.status(500).send({ error: "Erro ao atualizar configuração." });
  }
  return reply.send(data);
});
```

- [ ] **Step 4: Rodar testes para confirmar que passam**

```bash
cd apps/api && pnpm test src/routes/admin/__tests__/salomao-config.test.ts
```

Esperado: PASS — 3 testes passam.

- [ ] **Step 5: Adicionar seção Salomão no painel-gestor**

Em `apps/web/src/app/(dashboard)/painel-gestor/page.tsx`, adicionar no final do componente principal (antes do `return`), as seguintes adições:

Adicionar estados de config do Salomão após os states existentes:
```tsx
const [salomaoPrompt, setSalomaoPrompt] = useState("");
const [salomaoUpdatedAt, setSalomaoUpdatedAt] = useState("");
const [salomaoSaving, setSalomaoSaving] = useState(false);
const [salomaoSaved, setSalomaoSaved] = useState(false);
const [salomaoLoading, setSalomaoLoading] = useState(false);
```

Adicionar `loadSalomaoConfig` após os outros `useEffect` existentes:
```tsx
useEffect(() => {
  let cancelled = false;
  async function loadSalomaoConfig() {
    setSalomaoLoading(true);
    try {
      const data = await apiFetch("/admin/salomao-config");
      if (!cancelled) {
        setSalomaoPrompt((data as { system_prompt: string }).system_prompt ?? "");
        setSalomaoUpdatedAt((data as { updated_at: string }).updated_at ?? "");
      }
    } catch {
      // silencioso — não quebra o painel se config não existir ainda
    } finally {
      if (!cancelled) setSalomaoLoading(false);
    }
  }
  loadSalomaoConfig();
  return () => { cancelled = true; };
}, []);

async function saveSalomaoConfig() {
  if (!salomaoPrompt.trim()) return;
  setSalomaoSaving(true);
  try {
    const data = await apiFetch("/admin/salomao-config", {
      method: "PATCH",
      body: JSON.stringify({ system_prompt: salomaoPrompt.trim() }),
    });
    setSalomaoUpdatedAt((data as { updated_at: string }).updated_at ?? "");
    setSalomaoSaved(true);
    setTimeout(() => setSalomaoSaved(false), 2500);
  } finally {
    setSalomaoSaving(false);
  }
}
```

No JSX do `return`, adicionar uma seção "Salomão" após as seções existentes (antes do fechamento do elemento raiz):

```tsx
{/* ── Seção Salomão ── */}
<div className="mt-8 rounded-xl border border-border bg-card p-6">
  <div className="flex items-center justify-between mb-4">
    <div>
      <h2 className="text-base font-semibold">Configuração do Salomão</h2>
      <p className="text-xs text-muted-foreground mt-0.5">
        System prompt global do Salomão. Afeta todas as organizações imediatamente.
        {salomaoUpdatedAt && (
          <span className="ml-2">Última atualização: {new Date(salomaoUpdatedAt).toLocaleString("pt-BR")}</span>
        )}
      </p>
    </div>
    <button
      onClick={saveSalomaoConfig}
      disabled={salomaoSaving || !salomaoPrompt.trim()}
      className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
    >
      {salomaoSaving ? "Salvando..." : salomaoSaved ? "✓ Salvo!" : "Salvar alterações"}
    </button>
  </div>
  {salomaoLoading ? (
    <div className="h-48 animate-pulse rounded-lg bg-muted" />
  ) : (
    <textarea
      value={salomaoPrompt}
      onChange={(e) => setSalomaoPrompt(e.target.value)}
      className="w-full rounded-lg border border-border bg-muted/40 p-3 text-xs font-mono text-foreground resize-none focus:outline-none focus:ring-1 focus:ring-ring"
      style={{ minHeight: "300px" }}
      placeholder="System prompt do Salomão..."
    />
  )}
</div>
```

- [ ] **Step 6: Verificar TypeScript**

```bash
cd apps/web && pnpm tsc --noEmit
```

Esperado: sem erros.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/admin/index.ts \
        apps/api/src/routes/admin/__tests__/salomao-config.test.ts \
        apps/web/src/app/(dashboard)/painel-gestor/page.tsx
git commit -m "feat: admin salomao-config endpoints + seção no painel-gestor"
```

---

## Self-Review

**Spec coverage:**

| Requisito do spec | Task |
|---|---|
| SSE streaming para Salomão | Task 1 |
| `salomao_config` tabela + seed | Task 1 |
| Hook `use-salomao-stream` com AbortController | Task 2 |
| SalomaoDrawer como drawer lateral em /agents | Task 3 |
| Foco persistente após envio | Task 3 (SalomaoDrawer) |
| Textarea auto-expansivo no drawer | Task 3 (SalomaoDrawer) |
| Textarea auto-expansivo no AgentForm | Task 3 (agent-form) |
| `/agents/new?prompt=` preenche system_prompt | Task 3 (new/page) |
| Enter envia, Shift+Enter quebra linha | Task 3 (SalomaoDrawer) |
| Renomear "Biblioteca de Agentes" na nav | Task 4 |
| Remover SalomaoStudio da prompt-library | Task 4 |
| Admin Salomão no painel-gestor | Task 5 |
| API lê system prompt da tabela (não hardcoded) | Task 1 (resolveSystemPrompt) |
| Auditor ainda valida prompt no fluxo SSE | Task 1 |
| Endpoint antigo POST /chat preservado | Task 1 (não modificado) |
| Drawer fecha durante streaming → abort | Task 3 (useEffect cleanup) |
| Estados de erro com UI amigável | Task 3 (SalomaoDrawer error state) |

**Gaps encontrados e corrigidos:**
- `resolveSystemPrompt` faz fallback para `SALOMAO_SYSTEM_PROMPT` hardcoded caso a tabela ainda não tenha sido populada (migração pode não ter rodado em dev) — já incluído no Task 1.
- `useSearchParams` requer `<Suspense>` no Next.js 13+ — já incluído no Task 3, new/page.tsx.
- O `useEffect` de cleanup no drawer chama `abort()` quando `isOpen` vira `false`, garantindo que o AbortController cancele o stream.
