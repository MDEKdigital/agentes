# Pairing Code Connection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar botão "Conectar via Número" ao lado do QR Code na aba Conexão da página de instâncias, usando o fluxo de pairing code da Evolution API.

**Architecture:** Novo componente `PairingCodeDialog` (espelho do `QrCodeDialog` existente) com 3 estados internos (idle → code → connected). Backend expõe `POST /instances/:id/pairing-code` que chama `POST /instance/pairingCode/{name}` na Evolution API. Prefixo `55` concatenado pelo backend; usuário digita apenas DDD + número.

**Tech Stack:** Next.js 14 (App Router), React, TypeScript, Tailwind, shadcn/ui, Fastify, Vitest

---

## File Map

| Ação | Arquivo |
|------|---------|
| Criar | `apps/web/src/components/instances/pairing-code-dialog.tsx` |
| Modificar | `apps/web/src/app/(dashboard)/instances/[instanceId]/page.tsx` |
| Modificar | `apps/api/src/services/evolution.service.ts` |
| Modificar | `apps/api/src/routes/instances/index.ts` |
| Criar | `apps/api/src/routes/instances/__tests__/pairing-code.test.ts` |

---

## Task 1: Função `requestPairingCode` no evolution.service

**Files:**
- Modify: `apps/api/src/services/evolution.service.ts`

- [ ] **Step 1: Adicionar a função no final do arquivo**

Abra `apps/api/src/services/evolution.service.ts` e adicione ao final:

```typescript
export async function requestPairingCode(instanceName: string, phoneNumber: string) {
  return evolutionFetch(`/instance/pairingCode/${encodeURIComponent(instanceName)}`, {
    method: "POST",
    body: JSON.stringify({ number: phoneNumber }),
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/services/evolution.service.ts
git commit -m "feat: adicionar requestPairingCode ao evolution.service"
```

---

## Task 2: Endpoint `POST /instances/:instanceId/pairing-code`

**Files:**
- Modify: `apps/api/src/routes/instances/index.ts`
- Create: `apps/api/src/routes/instances/__tests__/pairing-code.test.ts`

- [ ] **Step 1: Escrever o teste que falhará**

Crie o arquivo `apps/api/src/routes/instances/__tests__/pairing-code.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";

vi.mock("@aula-agente/database", () => ({
  getAdminClient: vi.fn(() => ({})),
  getInstanceById: vi.fn(),
}));

vi.mock("../../../services/evolution.service", () => ({
  requestPairingCode: vi.fn(),
}));

vi.mock("../../../middleware/auth", () => ({
  authMiddleware: vi.fn(async (request: { user: unknown }) => {
    request.user = {
      memberships: [{ organization_id: "org-1", role: "admin" }],
    };
  }),
}));

import { getInstanceById } from "@aula-agente/database";
import { requestPairingCode } from "../../../services/evolution.service";
import instanceRoutes from "../index";

const mockInstance = {
  id: "inst-1",
  organization_id: "org-1",
  instance_name: "test-instance",
  status: "disconnected",
  phone_number: null,
};

async function buildApp() {
  const app = Fastify();
  await app.register(instanceRoutes);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /instances/:instanceId/pairing-code", () => {
  it("retorna código quando número válido (11 dígitos)", async () => {
    vi.mocked(getInstanceById).mockResolvedValue(mockInstance as never);
    vi.mocked(requestPairingCode).mockResolvedValue({ code: "ABCD-EFGH" });

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/instances/inst-1/pairing-code",
      payload: { phone_number: "11999999999" },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ code: "ABCD-EFGH" });
    expect(requestPairingCode).toHaveBeenCalledWith("test-instance", "5511999999999");
  });

  it("retorna código quando número válido (10 dígitos)", async () => {
    vi.mocked(getInstanceById).mockResolvedValue(mockInstance as never);
    vi.mocked(requestPairingCode).mockResolvedValue({ code: "WXYZ-1234" });

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/instances/inst-1/pairing-code",
      payload: { phone_number: "1199999999" },
    });

    expect(res.statusCode).toBe(200);
    expect(requestPairingCode).toHaveBeenCalledWith("test-instance", "551199999999");
  });

  it("retorna 400 quando número tem menos de 10 dígitos", async () => {
    vi.mocked(getInstanceById).mockResolvedValue(mockInstance as never);

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/instances/inst-1/pairing-code",
      payload: { phone_number: "119999" },
    });

    expect(res.statusCode).toBe(400);
  });

  it("retorna 400 quando número contém letras", async () => {
    vi.mocked(getInstanceById).mockResolvedValue(mockInstance as never);

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/instances/inst-1/pairing-code",
      payload: { phone_number: "1199999abc" },
    });

    expect(res.statusCode).toBe(400);
  });

  it("retorna 400 quando número tem mais de 11 dígitos", async () => {
    vi.mocked(getInstanceById).mockResolvedValue(mockInstance as never);

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/instances/inst-1/pairing-code",
      payload: { phone_number: "119999999991" },
    });

    expect(res.statusCode).toBe(400);
  });

  it("retorna 404 quando instância não existe", async () => {
    vi.mocked(getInstanceById).mockRejectedValue({ code: "PGRST116" });

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/instances/inst-99/pairing-code",
      payload: { phone_number: "11999999999" },
    });

    expect(res.statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: Rodar o teste para confirmar que falha**

```bash
cd apps/api && pnpm test --reporter=verbose 2>&1 | grep -A5 "pairing-code"
```

Esperado: falha com "Cannot find module" ou "route not found".

- [ ] **Step 3: Adicionar o endpoint em `instances/index.ts`**

Adicione ao início do arquivo a importação de `requestPairingCode`:

```typescript
import {
  createInstance as createEvolutionInstance,
  getInstanceStatus,
  getInstanceQrCode,
  deleteInstance as deleteEvolutionInstance,
  logoutInstance,
  fetchProfile,
  fetchInstanceDetails,
  updateProfileName,
  updateProfileStatus,
  updateProfilePicture,
  getInstanceSettings,
  setInstanceSettings,
  getPrivacySettings,
  updatePrivacySettings,
  restartInstance,
  requestPairingCode,
} from "../../services/evolution.service";
```

Adicione o endpoint antes do fechamento da função `instanceRoutes` (antes do `}` final), após o bloco do endpoint `logout`:

```typescript
  // Request pairing code (connect via phone number)
  app.post<{ Params: { instanceId: string } }>(
    "/instances/:instanceId/pairing-code",
    async (request, reply) => {
      const db = getAdminClient();
      let instance;
      try {
        instance = await getInstanceById(db, request.params.instanceId);
      } catch (err: unknown) {
        const code = (err as { code?: string })?.code;
        if (code === "PGRST116") return reply.status(404).send({ error: "Instância não encontrada" });
        throw err;
      }

      const membership = request.user.memberships.find(
        (m) => m.organization_id === instance.organization_id
      );
      if (!membership) return reply.status(403).send({ error: "Acesso negado" });

      const body = request.body as { phone_number?: unknown };
      const phone = String(body?.phone_number ?? "");

      if (!/^\d{10,11}$/.test(phone)) {
        return reply.status(400).send({ error: "Número inválido. Informe DDD + número (10 ou 11 dígitos, apenas números)" });
      }

      const fullNumber = `55${phone}`;
      const result = await requestPairingCode(instance.instance_name, fullNumber) as { code: string };
      return { code: result.code };
    }
  );
```

- [ ] **Step 4: Rodar os testes para confirmar que passam**

```bash
cd apps/api && pnpm test --reporter=verbose 2>&1 | grep -A3 "pairing-code"
```

Esperado: todos os 5 testes passam.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/instances/index.ts apps/api/src/routes/instances/__tests__/pairing-code.test.ts
git commit -m "feat: endpoint POST /instances/:id/pairing-code"
```

---

## Task 3: Componente `PairingCodeDialog`

**Files:**
- Create: `apps/web/src/components/instances/pairing-code-dialog.tsx`

- [ ] **Step 1: Criar o componente**

Crie `apps/web/src/components/instances/pairing-code-dialog.tsx`:

```typescript
"use client";

import { useState, useEffect, useRef } from "react";
import { apiFetch } from "@/lib/api";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Smartphone, Loader2, CheckCircle2 } from "lucide-react";

interface PairingCodeDialogProps {
  instanceId: string;
  onConnected?: (instanceData: Record<string, unknown>) => void;
}

type DialogState = "idle" | "loading" | "code" | "connected";

export function PairingCodeDialog({ instanceId, onConnected }: PairingCodeDialogProps) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<DialogState>("idle");
  const [phone, setPhone] = useState("");
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const connectedRef = useRef(false);

  useEffect(() => {
    if (!open) {
      setState("idle");
      setPhone("");
      setPairingCode(null);
      setError(null);
      connectedRef.current = false;
      return;
    }

    if (state !== "code") return;

    const checkStatus = async () => {
      if (connectedRef.current) return;
      try {
        const data = await apiFetch(`/instances/${instanceId}/status`);
        if (data.status === "connected") {
          connectedRef.current = true;
          setState("connected");
          onConnected?.(data);
          setTimeout(() => setOpen(false), 2500);
        }
      } catch {
        // ignore polling errors
      }
    };

    const statusInterval = setInterval(checkStatus, 5_000);
    return () => clearInterval(statusInterval);
  }, [open, state, instanceId, onConnected]);

  const handleSend = async () => {
    if (phone.length < 10) return;
    setState("loading");
    setError(null);
    try {
      const data = await apiFetch(`/instances/${instanceId}/pairing-code`, {
        method: "POST",
        body: JSON.stringify({ phone_number: phone }),
      });
      setPairingCode(data.code);
      setState("code");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao solicitar código");
      setState("idle");
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Smartphone className="mr-2 h-4 w-4" />
          Conectar via Número
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Conectar via Número</DialogTitle>
        </DialogHeader>

        <div className="flex min-h-[240px] flex-col items-center justify-center gap-4">
          {state === "idle" || state === "loading" ? (
            <>
              <p className="text-center text-sm text-muted-foreground">
                Digite o número do WhatsApp que deseja vincular
              </p>
              <div className="flex w-full max-w-xs items-center gap-2">
                <span className="shrink-0 rounded-md border border-input bg-muted px-3 py-2 text-sm text-muted-foreground">
                  +55
                </span>
                <Input
                  placeholder="11999999999"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 11))}
                  disabled={state === "loading"}
                  inputMode="numeric"
                />
              </div>
              {error && (
                <p className="text-center text-xs text-destructive">{error}</p>
              )}
              <Button
                onClick={handleSend}
                disabled={phone.length < 10 || state === "loading"}
                className="w-full max-w-xs"
              >
                {state === "loading" ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Aguarde...</>
                ) : (
                  "Enviar código"
                )}
              </Button>
            </>
          ) : state === "code" ? (
            <>
              <p className="text-center text-sm font-medium">Seu código de vinculação:</p>
              <p className="font-mono text-4xl font-bold tracking-widest text-foreground">
                {pairingCode}
              </p>
              <p className="max-w-xs text-center text-xs text-muted-foreground">
                Abra o WhatsApp no celular → Dispositivos vinculados → Vincular com número de telefone → Digite o código acima
              </p>
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </>
          ) : (
            <div className="flex flex-col items-center gap-3 text-center">
              <CheckCircle2 className="h-14 w-14 text-green-500" />
              <p className="text-base font-medium text-foreground">WhatsApp conectado!</p>
              <p className="text-xs text-muted-foreground">Carregando informações...</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Verificar que não há erros de TypeScript**

```bash
cd apps/web && pnpm tsc --noEmit 2>&1 | grep pairing
```

Esperado: nenhuma saída (sem erros).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/instances/pairing-code-dialog.tsx
git commit -m "feat: componente PairingCodeDialog"
```

---

## Task 4: Integrar na página de instâncias

**Files:**
- Modify: `apps/web/src/app/(dashboard)/instances/[instanceId]/page.tsx`

- [ ] **Step 1: Adicionar o import no topo do arquivo**

No arquivo `apps/web/src/app/(dashboard)/instances/[instanceId]/page.tsx`, adicione o import após a linha do `QrCodeDialog`:

```typescript
import { PairingCodeDialog } from "@/components/instances/pairing-code-dialog";
```

- [ ] **Step 2: Adicionar o componente ao lado do QrCodeDialog**

Localize o bloco (em torno da linha 186):

```tsx
<div className="flex gap-2">
  <QrCodeDialog
    instanceId={instanceId}
    onConnected={(data) => applyInstanceData(data)}
  />
  {instance.status === "connected" && (
```

Substitua por:

```tsx
<div className="flex gap-2">
  <QrCodeDialog
    instanceId={instanceId}
    onConnected={(data) => applyInstanceData(data)}
  />
  <PairingCodeDialog
    instanceId={instanceId}
    onConnected={(data) => applyInstanceData(data)}
  />
  {instance.status === "connected" && (
```

- [ ] **Step 3: Verificar que não há erros de TypeScript**

```bash
cd apps/web && pnpm tsc --noEmit 2>&1
```

Esperado: sem erros.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/(dashboard)/instances/[instanceId]/page.tsx
git commit -m "feat: adicionar PairingCodeDialog na aba Conexão da instância"
```

---

## Task 5: Smoke test manual

- [ ] **Step 1: Subir o ambiente de desenvolvimento**

```bash
# Na raiz do monorepo
docker-compose up -d
pnpm dev
```

- [ ] **Step 2: Acessar `/instances` e abrir uma instância desconectada**

Navegar para `http://localhost:3000/instances` → clicar em uma instância com status "Desconectado" → aba "Conexão".

Verificar que:
- Botão "Conectar via QR Code" ainda aparece
- Botão "Conectar via Número" aparece ao lado

- [ ] **Step 3: Testar o fluxo de pairing code**

1. Clicar em "Conectar via Número"
2. Verificar que o dialog abre com prefixo `+55` e campo de input
3. Digitar um número com 9 dígitos — botão "Enviar código" deve permanecer desabilitado
4. Digitar o 10º dígito — botão habilita
5. Clicar "Enviar código"
6. Verificar que o código de 8 dígitos aparece no dialog
7. Verificar que o spinner de "aguardando" aparece

- [ ] **Step 4: Verificar comportamento de fechar o dialog**

Fechar o dialog em qualquer estado e reabrir — verificar que volta ao estado inicial (campo vazio, sem código exibido).
