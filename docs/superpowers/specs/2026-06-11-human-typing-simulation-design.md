# Human Typing Simulation — Design Spec

## Overview

Adicionar indicador de "digitando..." e delay aleatório antes de enviar respostas do agente via WhatsApp, simulando comportamento humano. O contato verá o indicador de digitação por 3–8 segundos antes da mensagem aparecer.

## Escopo

Mudança restrita a um único arquivo: `apps/worker/src/workers/send-message.ts`. Sem novas dependências, sem mudanças em banco, sem novos jobs ou filas.

## Fluxo Modificado

**Antes:**
```
LLM responde → send-message job → sendText imediato
```

**Depois:**
```
LLM responde → send-message job → sendPresence("composing") → sleep(3–8s) → sendText → sendPresence("paused")
```

## Implementação

### Funções novas em `send-message.ts`

```ts
async function sendPresence(
  instanceName: string,
  phone: string,
  presence: "composing" | "paused"
): Promise<void>
```

Chama `POST /chat/sendPresence/{instanceName}` na Evolution API com body:
```json
{ "number": "<phone>", "options": { "presence": "<composing|paused>" } }
```

Erros de presença são silenciados (`console.warn`) — não devem impedir o envio da mensagem.

```ts
function randomDelay(min = 3000, max = 8000): Promise<void>
```

Retorna uma Promise que resolve após `Math.random() * (max - min) + min` milissegundos.

### Sequência dentro do worker job

1. Buscar instância no banco (como hoje)
2. Chamar `sendPresence(instanceName, phone, "composing")` — ignora erro
3. Chamar `await randomDelay()` — aguarda 3–8s aleatório
4. Chamar `sendEvolutionText(instanceName, phone, content)` — envia a mensagem
5. Chamar `sendPresence(instanceName, phone, "paused")` — remove indicador, ignora erro

### Tratamento de erros

- `sendPresence` nunca lança — envolve internamente em try/catch com `console.warn`
- `randomDelay` nunca lança — é apenas um `setTimeout` wrapped em Promise
- `sendEvolutionText` continua lançando normalmente — falha de envio deve ser retried pelo BullMQ

## Impacto no comportamento do worker

O `send-message` worker tem `concurrency: 20`. Com delay de até 8s por job, até 20 mensagens podem estar em delay simultâneo — nenhum problema de throughput para o volume esperado.

## Arquivos Modificados

| Arquivo | Tipo de mudança |
|---------|----------------|
| `apps/worker/src/workers/send-message.ts` | Adicionar `sendPresence`, `randomDelay`, atualizar sequência do job |

## Fora do Escopo

- Configuração do delay via dashboard (mín/máx fixos no código)
- "Visto" (read receipt) antes do typing
- Delay proporcional ao tamanho da resposta
- Simulação de erros de digitação no texto
