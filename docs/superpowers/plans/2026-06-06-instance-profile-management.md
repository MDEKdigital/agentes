# Instance Profile Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar card "Perfil do WhatsApp" na página de detalhe de instância para visualizar e editar nome, bio e foto de perfil via Evolution API.

**Architecture:** Novos métodos no Evolution service → duas novas rotas no Fastify (`GET` e `PATCH /instances/:id/profile`) → componente React auto-suficiente `ProfileCard` inserido na página de detalhe existente.

**Tech Stack:** TypeScript, Fastify, Supabase, Next.js 15, React 19, Tailwind CSS, Sonner (toasts), Evolution API REST

---

## Mapa de Arquivos

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `apps/api/src/services/evolution.service.ts` | Modificar | Adicionar 4 métodos de perfil |
| `apps/api/src/routes/instances/index.ts` | Modificar | Adicionar rotas GET e PATCH /profile |
| `apps/web/src/components/instances/profile-card.tsx` | Criar | Card de perfil auto-suficiente |
| `apps/web/src/app/(dashboard)/instances/[instanceId]/page.tsx` | Modificar | Inserir `<ProfileCard>` |

---

## Task 1: Evolution Service — Métodos de Perfil

**Files:**
- Modify: `apps/api/src/services/evolution.service.ts`

- [ ] **Step 1: Adicionar os 4 novos métodos ao serviço**

Abrir `apps/api/src/services/evolution.service.ts` e adicionar ao final do arquivo (antes do último `}`):

```typescript
export async function fetchProfile(instanceName: string, number: string) {
  const cleaned = number.replace(/\D/g, "");
  return evolutionFetch(`/chat/fetchProfile/${instanceName}?number=${cleaned}`);
}

export async function updateProfileName(instanceName: string, name: string) {
  return evolutionFetch(`/chat/updateProfileName/${instanceName}`, {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export async function updateProfileStatus(instanceName: string, status: string) {
  return evolutionFetch(`/chat/updateProfileStatus/${instanceName}`, {
    method: "POST",
    body: JSON.stringify({ status }),
  });
}

export async function updateProfilePicture(instanceName: string, pictureBase64: string) {
  return evolutionFetch(`/chat/updateProfilePicture/${instanceName}`, {
    method: "POST",
    body: JSON.stringify({ picture: pictureBase64 }),
  });
}
```

- [ ] **Step 2: Verificar TypeScript**

```bash
cd apps/api && pnpm typecheck
```

Esperado: sem erros.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/services/evolution.service.ts
git commit -m "feat: add profile methods to evolution service"
```

---

## Task 2: Backend — Rotas de Perfil

**Files:**
- Modify: `apps/api/src/routes/instances/index.ts`

- [ ] **Step 1: Importar os novos métodos no topo do arquivo de rotas**

Localizar o bloco de imports de `evolution.service` em `apps/api/src/routes/instances/index.ts` (linha ~12-17):

```typescript
import {
  createInstance as createEvolutionInstance,
  getInstanceStatus,
  getInstanceQrCode,
  deleteInstance as deleteEvolutionInstance,
  logoutInstance,
} from "../../services/evolution.service";
```

Substituir por:

```typescript
import {
  createInstance as createEvolutionInstance,
  getInstanceStatus,
  getInstanceQrCode,
  deleteInstance as deleteEvolutionInstance,
  logoutInstance,
  fetchProfile,
  updateProfileName,
  updateProfileStatus,
  updateProfilePicture,
} from "../../services/evolution.service";
```

- [ ] **Step 2: Adicionar rota GET /instances/:instanceId/profile**

Adicionar após a rota `GET /instances/:instanceId/status` (após a linha que fecha o handler de status, por volta da linha 99):

```typescript
  // Get WhatsApp profile
  app.get<{ Params: { instanceId: string } }>(
    "/instances/:instanceId/profile",
    async (request, reply) => {
      const db = getAdminClient();
      const instance = await getInstanceById(db, request.params.instanceId);

      const membership = request.user.memberships.find(
        (m) => m.organization_id === instance.organization_id
      );
      if (!membership) return reply.status(403).send({ error: "Access denied" });

      if (!instance.phone_number || instance.status !== "connected") {
        return { name: null, status: null, picture: null };
      }

      try {
        const profile = await fetchProfile(instance.instance_name, instance.phone_number) as Record<string, string>;
        return {
          name: profile.name ?? null,
          status: profile.status ?? null,
          picture: profile.picture ?? null,
        };
      } catch {
        return { name: null, status: null, picture: null };
      }
    }
  );
```

- [ ] **Step 3: Adicionar rota PATCH /instances/:instanceId/profile**

Adicionar logo após a rota GET /profile que acabou de ser criada:

```typescript
  // Update WhatsApp profile
  app.patch<{ Params: { instanceId: string } }>(
    "/instances/:instanceId/profile",
    async (request, reply) => {
      const db = getAdminClient();
      const instance = await getInstanceById(db, request.params.instanceId);

      const membership = request.user.memberships.find(
        (m) => m.organization_id === instance.organization_id && m.role !== "agent"
      );
      if (!membership) return reply.status(403).send({ error: "Admin access required" });

      const body = request.body as {
        name?: string;
        status?: string;
        picture?: string;
      };

      const tasks: Promise<unknown>[] = [];

      if (body.name !== undefined) {
        tasks.push(updateProfileName(instance.instance_name, body.name));
      }
      if (body.status !== undefined) {
        tasks.push(updateProfileStatus(instance.instance_name, body.status));
      }
      if (body.picture !== undefined) {
        tasks.push(updateProfilePicture(instance.instance_name, body.picture));
      }

      await Promise.all(tasks);
      return { ok: true };
    }
  );
```

- [ ] **Step 4: Verificar TypeScript**

```bash
cd apps/api && pnpm typecheck
```

Esperado: sem erros.

- [ ] **Step 5: Testar rotas manualmente com curl**

Com a API rodando (`pnpm dev`), obtenha um token JWT válido do Supabase e o instanceId de uma instância conectada, então:

```bash
# GET profile (substitua TOKEN e INSTANCE_ID)
curl -H "Authorization: Bearer TOKEN" \
     http://localhost:3001/instances/INSTANCE_ID/profile
# Esperado: { "name": "...", "status": "...", "picture": "https://..." }

# PATCH profile (teste de nome)
curl -X PATCH \
     -H "Authorization: Bearer TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"name": "Meu Bot"}' \
     http://localhost:3001/instances/INSTANCE_ID/profile
# Esperado: { "ok": true }
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/instances/index.ts
git commit -m "feat: add GET and PATCH profile routes for instances"
```

---

## Task 3: Frontend — Componente ProfileCard

**Files:**
- Create: `apps/web/src/components/instances/profile-card.tsx`

- [ ] **Step 1: Criar o arquivo do componente**

Criar `apps/web/src/components/instances/profile-card.tsx` com o seguinte conteúdo:

```typescript
"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Camera, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface ProfileCardProps {
  instanceId: string;
  instanceStatus: string;
}

interface Profile {
  name: string | null;
  status: string | null;
  picture: string | null;
}

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function ProfileCard({ instanceId, instanceStatus }: ProfileCardProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [saving, setSaving] = useState(false);

  const [original, setOriginal] = useState<Profile>({ name: null, status: null, picture: null });
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [picturePreview, setPicturePreview] = useState<string | null>(null);
  const [pictureFile, setPictureFile] = useState<File | null>(null);

  const disabled = instanceStatus !== "connected";

  const isDirty =
    name !== (original.name ?? "") ||
    bio !== (original.status ?? "") ||
    pictureFile !== null;

  useEffect(() => {
    if (disabled) {
      setLoadingProfile(false);
      return;
    }

    apiFetch(`/instances/${instanceId}/profile`)
      .then((data: Profile) => {
        setOriginal(data);
        setName(data.name ?? "");
        setBio(data.status ?? "");
        setPicturePreview(data.picture ?? null);
      })
      .catch(() => {
        // silently show empty fields
      })
      .finally(() => setLoadingProfile(false));
  }, [instanceId, disabled]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > MAX_FILE_SIZE) {
      toast.error("A imagem deve ter no máximo 5MB");
      return;
    }

    setPictureFile(file);
    setPicturePreview(URL.createObjectURL(file));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const body: Record<string, string> = {};

      if (name !== (original.name ?? "")) body.name = name;
      if (bio !== (original.status ?? "")) body.status = bio;
      if (pictureFile) body.picture = await fileToBase64(pictureFile);

      await apiFetch(`/instances/${instanceId}/profile`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });

      setOriginal({ name: name || null, status: bio || null, picture: picturePreview });
      setPictureFile(null);
      toast.success("Perfil atualizado com sucesso");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar perfil");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          Perfil do WhatsApp
          {disabled && (
            <span className="text-xs font-normal text-destructive">
              Instância desconectada
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {loadingProfile ? (
          <div className="space-y-3">
            <div className="flex items-center gap-4">
              <div className="h-16 w-16 animate-pulse rounded-full bg-muted" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
                <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
              </div>
            </div>
          </div>
        ) : (
          <div className={cn("space-y-4", disabled && "pointer-events-none opacity-50")}>
            {/* Photo */}
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="group relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-full border-2 border-border bg-muted transition-colors hover:border-primary"
                disabled={disabled || saving}
              >
                {picturePreview ? (
                  <img
                    src={picturePreview}
                    alt="Foto de perfil"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <Camera className="absolute inset-0 m-auto h-6 w-6 text-muted-foreground" />
                )}
                <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                  <Camera className="h-5 w-5 text-white" />
                </div>
              </button>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileChange}
              />

              <div className="flex-1 space-y-1">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Clique na foto para alterar
                </p>
                <p className="text-xs text-muted-foreground">PNG, JPG ou WEBP — máx. 5MB</p>
              </div>
            </div>

            {/* Name */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Nome de exibição
                </label>
                <span className="text-xs text-muted-foreground">{name.length}/25</span>
              </div>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value.slice(0, 25))}
                placeholder="Nome do bot"
                disabled={disabled || saving}
                className="bg-muted border-border"
              />
            </div>

            {/* Bio */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Bio / Status
                </label>
                <span className="text-xs text-muted-foreground">{bio.length}/139</span>
              </div>
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value.slice(0, 139))}
                placeholder="Status de exibição no WhatsApp"
                disabled={disabled || saving}
                rows={2}
                className={cn(
                  "w-full resize-none rounded-md border border-border bg-muted px-3 py-2 text-sm",
                  "placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring",
                  "disabled:cursor-not-allowed disabled:opacity-50"
                )}
              />
            </div>

            {/* Save button */}
            <div className="flex justify-end">
              <button
                onClick={handleSave}
                disabled={!isDirty || saving || disabled}
                className="flex items-center gap-2 rounded-lg bg-amber-fire-500 px-4 py-2 text-sm font-semibold text-[#0F1219] transition-colors hover:bg-amber-fire-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                {saving ? "Salvando..." : "Salvar Perfil"}
              </button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Verificar TypeScript**

```bash
cd apps/web && pnpm typecheck
```

Esperado: sem erros.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/instances/profile-card.tsx
git commit -m "feat: add ProfileCard component for WhatsApp profile management"
```

---

## Task 4: Integrar ProfileCard na Página de Detalhe

**Files:**
- Modify: `apps/web/src/app/(dashboard)/instances/[instanceId]/page.tsx`

- [ ] **Step 1: Adicionar import do ProfileCard**

No topo de `apps/web/src/app/(dashboard)/instances/[instanceId]/page.tsx`, após os imports existentes, adicionar:

```typescript
import { ProfileCard } from "@/components/instances/profile-card";
```

- [ ] **Step 2: Inserir o card na página**

Localizar o trecho:

```tsx
      <div className="flex justify-end">
        <Button variant="destructive" onClick={handleDelete}>
          <Trash2 className="mr-2 h-4 w-4" />
          Excluir Instancia
        </Button>
      </div>
```

Substituir por:

```tsx
      <ProfileCard instanceId={instanceId} instanceStatus={instance.status} />

      <div className="flex justify-end">
        <Button variant="destructive" onClick={handleDelete}>
          <Trash2 className="mr-2 h-4 w-4" />
          Excluir Instancia
        </Button>
      </div>
```

- [ ] **Step 3: Verificar TypeScript**

```bash
cd apps/web && pnpm typecheck
```

Esperado: sem erros.

- [ ] **Step 4: Testar no browser**

1. Abrir `http://localhost:3000/instances`
2. Clicar em uma instância **desconectada** → card "Perfil do WhatsApp" deve aparecer com badge "Instância desconectada" e campos desabilitados
3. Clicar em uma instância **conectada** → card deve carregar skeleton e depois exibir nome/bio/foto atual
4. Alterar o nome e clicar "Salvar Perfil" → toast "Perfil atualizado com sucesso"
5. Selecionar uma foto (< 5MB) → preview deve aparecer imediatamente no círculo
6. Selecionar foto > 5MB → toast de erro "A imagem deve ter no máximo 5MB"
7. Sem mudanças → botão "Salvar Perfil" deve estar desabilitado

- [ ] **Step 5: Commit final**

```bash
git add apps/web/src/app/\(dashboard\)/instances/\[instanceId\]/page.tsx
git commit -m "feat: integrate ProfileCard in instance detail page"
```

---

## Verificação Final

- [ ] Abrir `http://localhost:3000/instances`, entrar em uma instância conectada e confirmar que o card "Perfil do WhatsApp" exibe os dados corretos do WhatsApp
- [ ] Atualizar nome e bio e confirmar que os campos refletem os novos valores após salvar (sem reload)
- [ ] Confirmar que o card de instância desconectada mostra o badge e bloqueia edição
