# Instance Profile Management — Design Spec

**Data:** 2026-06-06  
**Escopo:** Gerenciamento de perfil WhatsApp (nome, bio, foto) na página de detalhe de instância

---

## Contexto

A página de detalhe de instância (`/instances/[instanceId]`) já gerencia conexão via QR Code, logout, exclusão e vínculo de agente. O objetivo desta spec é adicionar um card "Perfil do WhatsApp" que permite visualizar e editar o perfil da conta conectada à instância via Evolution API.

---

## O que já existe

| Recurso | Status |
|---|---|
| Criar instância | ✅ |
| Listar instâncias | ✅ |
| Status da instância (refresh manual) | ✅ |
| Conectar via QR Code | ✅ |
| Desconectar (logout) | ✅ |
| Excluir instância | ✅ |
| Vincular agente | ✅ |

---

## O que será construído

Um novo card **"Perfil do WhatsApp"** na página de detalhe da instância (`apps/web/src/app/(dashboard)/instances/[instanceId]/page.tsx`) com:

- Preview e upload da foto de perfil
- Edição do nome de exibição
- Edição da bio/status
- Botão único "Salvar Perfil"
- Estado desabilitado quando instância está desconectada

---

## Endpoints Evolution API utilizados

| Operação | Método | Endpoint Evolution |
|---|---|---|
| Buscar perfil atual | `GET` | `/chat/fetchProfile/{instance}?number={phone}` |
| Atualizar nome | `POST` | `/chat/updateProfileName/{instance}` body: `{ name }` |
| Atualizar bio | `POST` | `/chat/updateProfileStatus/{instance}` body: `{ status }` |
| Atualizar foto | `POST` | `/chat/updateProfilePicture/{instance}` body: `{ picture: base64 }` |

---

## Backend — Novas rotas da API Fastify

### `GET /instances/:instanceId/profile`

- Valida membership do usuário
- Busca a instância no DB para obter `instance_name` e `phone_number`
- Chama `GET /chat/fetchProfile/{instance_name}?number={phone_number}` na Evolution
- Retorna `{ name, status, picture }` (fields da Evolution)
- Se `phone_number` for null ou instância desconectada, retorna `{ name: null, status: null, picture: null }`

### `PATCH /instances/:instanceId/profile`

- Valida membership (role `owner` ou `admin`)
- Aceita body: `{ name?: string, status?: string, picture?: string }` (picture em base64)
- Para cada campo presente no body, chama o endpoint correspondente da Evolution em paralelo (`Promise.all`)
- Retorna `{ ok: true }` em sucesso ou erro descritivo por campo

---

## Frontend — Novo componente

**Arquivo:** `apps/web/src/components/instances/profile-card.tsx`

### Responsabilidades
- Carregar perfil atual ao montar (chama `GET /instances/:id/profile`)
- Gerenciar estado local: `name`, `bio`, `pictureFile` (File), `picturePreview` (URL objeto)
- Detectar mudanças em relação ao carregado (dirty state) para habilitar botão "Salvar"
- Converter `File` para base64 antes de enviar
- Chamar `PATCH /instances/:id/profile` com apenas os campos alterados
- Exibir feedback de loading e erros inline no card

### Estados do card
| Estado | Comportamento |
|---|---|
| `instance.status !== "connected"` | Card desabilitado, badge "Instância desconectada" |
| Carregando perfil inicial | Skeleton nos campos |
| Pronto para edição | Campos habilitados |
| Salvando | Botão com spinner, campos readonly |
| Erro ao salvar | Toast de erro, campos voltam a editável |

### Layout do card

```
┌─────────────────────────────────────────┐
│ Perfil do WhatsApp                      │
├─────────────────────────────────────────┤
│  [foto circular]  Nome                  │
│   (clicável)      [input text]          │
│                   Bio / Status          │
│                   [textarea]            │
│                              [Salvar]   │
└─────────────────────────────────────────┘
```

- Foto: `<div>` circular 64×64px com `<input type="file" accept="image/*">` oculto
- Ao selecionar arquivo: `URL.createObjectURL(file)` para preview imediato
- Nome: máx. 25 caracteres, contador visível
- Bio: máx. 139 caracteres, contador visível
- Botão "Salvar Perfil": desabilitado até haver mudança (dirty), mostra spinner durante `PATCH`

---

## Integração na página de detalhe

**Arquivo:** `apps/web/src/app/(dashboard)/instances/[instanceId]/page.tsx`

O `<ProfileCard instanceId={instanceId} status={instance.status} />` é inserido após o card "Agente Vinculado" e antes do botão "Excluir Instância".

Não requer mudanças de estado na página pai — o card é auto-suficiente (busca e salva por conta própria).

---

## Serviço Evolution — Novos métodos

**Arquivo:** `apps/api/src/services/evolution.service.ts`

```typescript
export async function fetchProfile(instanceName: string, number: string)
export async function updateProfileName(instanceName: string, name: string)
export async function updateProfileStatus(instanceName: string, status: string)
export async function updateProfilePicture(instanceName: string, pictureBase64: string)
```

---

## Tratamento de erros

| Cenário | Comportamento |
|---|---|
| Instância desconectada ao tentar buscar perfil | Card mostra campos vazios, estado disabled |
| Evolution retorna erro ao buscar perfil | Card mostra campos vazios (não bloqueia a página) |
| Erro ao salvar um dos campos | Toast com mensagem específica, outros campos mantêm o valor novo |
| Arquivo de foto muito grande (>5MB) | Validação client-side antes do upload, mensagem inline |

---

## Fora do escopo desta spec

- Configurações da instância (rejectCall, alwaysOnline, etc.) — spec futura
- Gerenciamento de webhook — spec futura
- Pairing code como alternativa ao QR Code — spec futura
- Restart de instância — spec futura
- Status em tempo real via webhook — spec futura
