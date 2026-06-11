# Conexão via Número (Pairing Code)

**Data:** 2026-06-11  
**Status:** Aprovado

## Contexto

A página `/instances/[instanceId]` (aba Conexão) oferece apenas conexão via QR Code (`QrCodeDialog`). A Evolution API suporta também o método de pairing code: o usuário informa o número de telefone do WhatsApp que quer vincular, recebe um código de 8 dígitos no próprio app e digita esse código em "Dispositivos vinculados > Vincular com número de telefone".

## Objetivo

Adicionar um botão **"Conectar via Número"** ao lado do botão "Conectar via QR Code" na aba Conexão, implementando o fluxo completo de pairing code.

## Fluxo do Usuário

1. Usuário clica em **"Conectar via Número"**
2. Dialog abre com campo de entrada — prefixo `+55` fixo visualmente + input para DDD + número (ex: `11999999999`)
3. Clica **"Enviar código"** → frontend concatena `55` + input e envia para o backend
4. Backend chama Evolution API e retorna o código de 8 dígitos (ex: `ABCD-EFGH`)
5. Dialog exibe o código com instrução: "Abra o WhatsApp > Dispositivos vinculados > Vincular com número de telefone"
6. Sistema faz polling a cada 5s em `/instances/:id/status`
7. Ao detectar `status === "connected"`: exibe tela de sucesso, fecha o dialog após 2,5s e dispara `onConnected`

## Arquitetura

### Frontend

**Novo arquivo:** `apps/web/src/components/instances/pairing-code-dialog.tsx`

- Props: `instanceId: string`, `onConnected?: (data: Record<string, unknown>) => void`
- Estados internos: `idle` | `code` | `connected`
- Estado `idle`: campo com prefixo `+55` + input numérico; botão "Enviar código" (desabilitado se < 10 dígitos)
- Estado `code`: exibe o código formatado em fonte grande + instrução de uso; polling de status ativo
- Estado `connected`: ícone de sucesso, mensagem "WhatsApp conectado!", fecha em 2,5s
- Ao fechar o dialog (qualquer estado): reseta para `idle`, cancela intervalos

**Alterado:** `apps/web/src/app/(dashboard)/instances/[instanceId]/page.tsx`

- Importa `PairingCodeDialog`
- Adiciona `<PairingCodeDialog instanceId={instanceId} onConnected={(data) => applyInstanceData(data)} />` ao lado do `<QrCodeDialog>` no `flex gap-2` da aba Conexão (linha ~186)

### Backend

**Novo serviço:** `requestPairingCode(instanceName: string, phoneNumber: string)` em `apps/api/src/services/evolution.service.ts`

```
POST /instance/pairingCode/{instanceName}
Body: { "number": phoneNumber }
Retorna: { code: string }
```

**Novo endpoint:** `POST /instances/:instanceId/pairing-code` em `apps/api/src/routes/instances/index.ts`

- Autenticado via `authMiddleware` (já aplicado no plugin)
- Valida `phone_number` no body: só dígitos, entre 10 e 11 chars (DDD + número sem o `55`)
- Monta o número completo: `"55" + phone_number`
- Chama `requestPairingCode(instance.instance_name, fullNumber)`
- Retorna `{ code }` com status 200
- Retorna 400 se validação falhar, 404 se instância não encontrada, 403 se sem permissão

## Validação do Número

| Camada    | Regra                                              |
|-----------|----------------------------------------------------|
| Frontend  | Bloqueia envio se campo tiver < 10 dígitos         |
| Backend   | Rejeita (400) se não for só dígitos ou fora de 10-11 chars |

O frontend aceita apenas dígitos no input (máscara simples `replace(/\D/g, "")`). O número completo enviado para a Evolution tem sempre o prefixo `55`.

## Polling de Status

Idêntico ao `QrCodeDialog` existente:
- `setInterval(checkStatus, 5_000)` ativo enquanto o dialog estiver aberto no estado `code`
- Cancela ao fechar ou ao detectar conexão
- Usa o mesmo endpoint `GET /instances/:instanceId/status`

## O que não muda

- `QrCodeDialog` — sem alterações
- Lógica de `applyInstanceData` na página — reutilizada via `onConnected`
- Nenhuma migration de banco — não há novo campo necessário
