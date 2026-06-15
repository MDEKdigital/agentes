# Humanização Global — Design Spec

**Data:** 2026-06-15
**Status:** Aprovado

---

## Overview

Atualizar o worker `send-message` para implementar a Regra Global de Humanização em todas as mensagens enviadas via WhatsApp — tanto respostas de agentes IA quanto mensagens de remarketing. As mudanças se concentram em um único arquivo: `apps/worker/src/workers/send-message.ts`.

---

## Problema atual

A implementação existente já possui `sendPresence("composing")` e `randomDelay`, mas viola a regra global em dois pontos:

1. **Delay máximo de 8s** — a regra limita a 5s
2. **Sem proporcionalidade** — delay fixo independente do tamanho da mensagem
3. **Sem divisão de mensagens** — respostas longas chegam como um bloco único, sem o comportamento natural de múltiplas mensagens com typing entre elas

---

## Escopo

Mudança restrita a um único arquivo: `apps/worker/src/workers/send-message.ts`.

Cobertura automática:
- **Agentes IA** — `process-message` enfileira para `SEND_MESSAGE`
- **Remarketing** — `remarketing-worker` enfileira para `SEND_MESSAGE`

---

## Funções novas / modificadas

### `splitMessage(text: string): string[]`

Divide o texto em partes para envio sequencial.

- Divide por `\n\n` (parágrafos)
- Remove partes vazias ou só whitespace
- Limita a **3 partes máximo** — se houver mais parágrafos, o 3º recebe o restante concatenado
- Se não houver `\n\n`, retorna array com 1 elemento (comportamento idêntico ao atual)

```
"Olá!\n\nVeja as opções:\n- A\n- B\n\nQualquer dúvida, fale comigo."
→ ["Olá!", "Veja as opções:\n- A\n- B", "Qualquer dúvida, fale comigo."]
```

### `typingDelay(text: string): Promise<void>` *(substitui `randomDelay`)*

Delay aleatório proporcional ao tamanho da parte que será enviada:

| Tamanho da parte | Faixa de delay |
|---|---|
| ≤ 100 chars (curta) | 1000–2000 ms |
| 101–300 chars (média) | 2000–4000 ms |
| > 300 chars (longa) | 3000–5000 ms |

Nunca ultrapassa 5s — cumpre a regra global.

### `shortPause(): Promise<void>` *(nova)*

Pausa de 500–1000ms entre o envio de uma parte e o início do typing da próxima. Simula o intervalo natural entre mensagens.

---

## Sequência no worker job

```
partes = splitMessage(content)

para cada parte:
  sendPresence("composing")
  await typingDelay(parte)
  await sendEvolutionText(parte)
  sendPresence("paused")
  se não for a última parte:
    await shortPause()
```

### Comparação com fluxo anterior

**Antes:**
```
sendPresence("composing") → randomDelay(3–8s) → sendText → sendPresence("paused")
```

**Depois (1 parágrafo):**
```
sendPresence("composing") → typingDelay(proporcional) → sendText → sendPresence("paused")
```

**Depois (3 parágrafos):**
```
composing → typingDelay → sendText → paused → shortPause →
composing → typingDelay → sendText → paused → shortPause →
composing → typingDelay → sendText → paused
```

---

## Tratamento de erros

- `sendPresence` continua silenciando erros com `console.warn` — nunca impede o envio
- `typingDelay` e `shortPause` nunca lançam — são `setTimeout` wrapped em Promise
- `sendEvolutionText` continua lançando normalmente — falha de envio é retried pelo BullMQ
- Se uma parte falha, o job inteiro é retried — mesma garantia da implementação atual

---

## Arquivos modificados

| Arquivo | Mudança |
|---|---|
| `apps/worker/src/workers/send-message.ts` | Adicionar `splitMessage`, `typingDelay`, `shortPause`; atualizar sequência do job; remover `randomDelay` |

---

## Fora do escopo

- Configuração dos thresholds via dashboard
- Divisão por sentenças ou tamanho fixo de caracteres
- Simulação de erros de digitação no texto
- "Visto" (read receipt) antes do typing
