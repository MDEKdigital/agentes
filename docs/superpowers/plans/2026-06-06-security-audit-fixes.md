# Security Audit Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir os 8 findings confirmados pela auditoria de código (3 críticos, 3 altos, 2 médios).

**Architecture:** Fixes distribuídos em 9 arquivos: server.ts (startup checks), webhook-verify.ts, instances/index.ts, lib/crypto.ts (novo), secrets/index.ts, vault.ts, api.ts (web), documents.ts, faqs.ts.

**Tech Stack:** Node.js crypto (AES-256-GCM), Fastify, TypeScript, Supabase, Next.js

---

### Task 1: Startup validation — WEBHOOK_SECRET e PUBLIC_API_URL obrigatórios

**Files:**
- Modify: `apps/api/src/server.ts`

- [ ] Adicionar validação antes do `start()`:

```ts
// apps/api/src/server.ts — adicionar após os imports, antes do `const server = Fastify(...)`
const REQUIRED_ENV = ["WEBHOOK_SECRET", "PUBLIC_API_URL"] as const;
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`Missing required environment variable: ${key}`);
    process.exit(1);
  }
}
```

- [ ] Commit: `git commit -m "fix: require WEBHOOK_SECRET and PUBLIC_API_URL at startup"`

---

### Task 2: Fix SSRF — usar PUBLIC_API_URL em vez de request.hostname

**Files:**
- Modify: `apps/api/src/routes/instances/index.ts:61`

- [ ] Substituir linha 61:

```ts
// antes
const webhookUrl = `${request.protocol}://${request.hostname}:${apiPort}/webhooks/evolution`;

// depois
const webhookUrl = `${process.env.PUBLIC_API_URL}/webhooks/evolution`;
```

- [ ] Remover a linha `const apiPort = process.env.API_PORT || "3001";` (linha 60) — não é mais necessária aqui.

- [ ] Commit: `git commit -m "fix: use PUBLIC_API_URL env var for webhook registration (prevent SSRF)"`

---

### Task 3: getInstanceById sem try/catch em 5 rotas

**Files:**
- Modify: `apps/api/src/routes/instances/index.ts` (linhas 84, 202, 219, 241, 265)

- [ ] Wrap cada `getInstanceById` sem guarda com o mesmo padrão já usado nas rotas /profile:

```ts
// Padrão a aplicar em cada rota:
let instance;
try {
  instance = await getInstanceById(db, request.params.instanceId);
} catch (err: unknown) {
  const code = (err as { code?: string })?.code;
  if (code === "PGRST116") return reply.status(404).send({ error: "Instância não encontrada" });
  throw err;
}
```

Aplicar em: GET /status, GET /qrcode, PATCH /instances/:instanceId, DELETE /instances/:instanceId, POST /logout

- [ ] Commit: `git commit -m "fix: guard getInstanceById with 404 handler in all 5 instance routes"`

---

### Task 4: Log errors no fetchProfile em vez de catch silencioso

**Files:**
- Modify: `apps/api/src/routes/instances/index.ts:136`

- [ ] Substituir o catch vazio:

```ts
// antes
} catch {
  return { name: null, status: null, picture: null };
}

// depois
} catch (err) {
  request.log.warn({ err }, "fetchProfile failed — returning empty profile");
  return { name: null, status: null, picture: null };
}
```

- [ ] Commit: `git commit -m "fix: log fetchProfile errors instead of swallowing silently"`

---

### Task 5: Criptografia de secrets (AES-256-GCM)

**Files:**
- Create: `apps/api/src/lib/crypto.ts`
- Modify: `apps/api/src/routes/secrets/index.ts`
- Modify: `apps/worker/src/lib/vault.ts`

- [ ] Criar `apps/api/src/lib/crypto.ts`:

```ts
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const PREFIX = "enc:v1:";

function getKey(): Buffer {
  const hex = process.env.SECRET_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error("SECRET_ENCRYPTION_KEY must be a 64-char hex string (32 bytes)");
  }
  return Buffer.from(hex, "hex");
}

export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + [iv, tag, encrypted].map((b) => b.toString("hex")).join(":");
}

export function decrypt(value: string): string {
  // Legacy plaintext — stored before encryption was added
  if (!value.startsWith(PREFIX)) return value;
  const [ivHex, tagHex, dataHex] = value.slice(PREFIX.length).split(":");
  const key = getKey();
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return decipher.update(Buffer.from(dataHex, "hex")).toString("utf8") + decipher.final("utf8");
}
```

- [ ] Criar arquivo equivalente para o worker `apps/worker/src/lib/crypto.ts` (conteúdo idêntico).

- [ ] Em `apps/api/src/routes/secrets/index.ts`, importar encrypt e adicionar provider allowlist:

```ts
import { encrypt } from "../../lib/crypto";

const ALLOWED_PROVIDERS = ["openai", "anthropic", "google"] as const;

// No PUT handler, adicionar após a checagem de membership:
if (!ALLOWED_PROVIDERS.includes(provider as (typeof ALLOWED_PROVIDERS)[number])) {
  return reply.status(400).send({ error: `Provider inválido. Permitidos: ${ALLOWED_PROVIDERS.join(", ")}` });
}

// Substituir linha 52:
// antes: { organization_id: organizationId, provider, encrypted_key: key.trim() }
// depois:
{ organization_id: organizationId, provider, encrypted_key: encrypt(key.trim()) }
```

- [ ] Em `apps/worker/src/lib/vault.ts`, importar decrypt e usar:

```ts
import { decrypt } from "./crypto";

// Na linha 40, substituir:
// antes: return data.encrypted_key;
// depois:
return decrypt(data.encrypted_key);
```

- [ ] Adicionar `SECRET_ENCRYPTION_KEY` à lista de REQUIRED_ENV em server.ts (Task 1).

- [ ] Commit: `git commit -m "feat: add AES-256-GCM encryption for organization secrets"`

---

### Task 6: IDOR — verificar que agentId pertence à organização

**Files:**
- Modify: `apps/api/src/routes/knowledge/documents.ts`
- Modify: `apps/api/src/routes/knowledge/faqs.ts`

- [ ] Em `documents.ts`, adicionar import e check após membership:

```ts
import { getAdminClient, getDocumentsByAgent, getDocumentById, deleteDocument, getAgentById } from "@aula-agente/database";

// No GET handler, após o membership check:
const db = getAdminClient();
let agent;
try {
  agent = await getAgentById(db, agentId);
} catch {
  return reply.status(404).send({ error: "Agente não encontrado" });
}
if (agent.organization_id !== organizationId) {
  return reply.status(403).send({ error: "Access denied" });
}

// No POST handler, mesma lógica após membership check.
```

- [ ] Em `faqs.ts`, mesma correção para o GET `/organizations/:organizationId/agents/:agentId/faqs`:

```ts
import { getAdminClient, getFaqsByAgent, createFaq, updateFaq, deleteFaq, getAgentById } from "@aula-agente/database";

// No GET handler, após o membership check:
const db = getAdminClient();
let agent;
try {
  agent = await getAgentById(db, agentId);
} catch {
  return reply.status(404).send({ error: "Agente não encontrado" });
}
if (agent.organization_id !== organizationId) {
  return reply.status(403).send({ error: "Access denied" });
}
```

- [ ] Commit: `git commit -m "fix: verify agentId ownership against organizationId to prevent IDOR"`

---

### Task 7: apiFetch — autenticação e serialização de erros Zod

**Files:**
- Modify: `apps/web/src/lib/api.ts`

- [ ] Substituir o corpo de `apiFetch`:

```ts
export async function apiFetch(path: string, options: RequestInit = {}) {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    throw new Error("Sessão expirada. Faça login novamente.");
  }

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
        ...options.headers,
      },
    });
  } catch {
    throw new Error(
      `Não foi possível conectar ao servidor em ${API_URL}.\nVerifique se a API está rodando.`
    );
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: "Request failed" }));
    const message = Array.isArray(body.error)
      ? body.error.map((i: { message?: string }) => i.message ?? JSON.stringify(i)).join("; ")
      : body.error || `Erro na API: ${response.status}`;
    throw new Error(message);
  }

  if (response.status === 204) return null;
  return response.json();
}
```

- [ ] Commit: `git commit -m "fix: throw on missing session and serialize Zod array errors in apiFetch"`

---

### Task 8: Documentar variáveis de ambiente necessárias

**Files:**
- Modify: `.env.example` ou `README.md` (se existir)

- [ ] Verificar se existe `.env.example` e adicionar as novas variáveis:

```
PUBLIC_API_URL=http://localhost:3001
SECRET_ENCRYPTION_KEY=<64 char hex string — generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">
```

- [ ] Commit: `git commit -m "docs: document new required environment variables"`
