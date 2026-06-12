# Response Validation (Guardrail) — Design Spec

## Overview

Após o LLM gerar uma resposta, um segundo modelo barato verifica se a resposta viola alguma regra explícita do system prompt. Se violar, regenera a resposta (até 2 tentativas extras). Se todas as tentativas falharem na validação, envia a última resposta mesmo assim (fail open).

## Escopo

Mudança restrita a um único arquivo: `apps/worker/src/agents/agent-runner.ts`. Sem novas dependências — o Vercel AI SDK já está disponível.

## Fluxo

```
generateText (tentativa 1)
  → validateResponse
    → compliant: true  → retorna texto ✅
    → compliant: false → generateText (tentativa 2)
                           → validateResponse
                             → compliant: true  → retorna texto ✅
                             → compliant: false → generateText (tentativa 3)
                                                    → validateResponse
                                                      → qualquer resultado → retorna texto (fail open) + console.warn ⚠️
```

Máximo 3 gerações totais por mensagem.

## Modelos de Validação

| Provider do agente | Modelo usado na validação |
|--------------------|--------------------------|
| `openai` | `gpt-4.1-nano` |
| `anthropic` | `claude-haiku-4-20250414` |
| `google` | `gemini-2.0-flash-lite` |

O modelo de validação sempre usa o mesmo provider e API key do agente — sem config extra.

## Prompt do Validador

```
Você é um verificador de conformidade. O system prompt abaixo contém regras que o assistente DEVE seguir. Verifique se a resposta gerada viola alguma regra explícita.

System prompt:
<system_prompt>

Resposta gerada:
<response>

Responda APENAS com JSON válido, sem markdown:
{"compliant": true}
ou
{"compliant": false, "violation": "descrição breve da regra violada"}
```

## Função `validateResponse`

```ts
async function validateResponse(params: {
  systemPrompt: string;
  response: string;
  provider: LLMProvider;
  apiKey: string;
}): Promise<{ compliant: boolean; violation?: string }>
```

- Usa `generateText` do Vercel AI SDK com `maxTokens: 100` e `temperature: 0`
- Faz parse do JSON retornado; se o parse falhar → assume `compliant: true` (fail open)
- Timeout implícito via SDK

## Integração em `runAgent`

O loop de geração + validação substitui a chamada única a `generateText`. O restante da função (`latencyMs`, `toolCalls`, `tokensUsed`) é calculado sobre todas as tentativas somadas.

## Tratamento de Erros

| Situação | Comportamento |
|----------|--------------|
| Validador não consegue parsear JSON | `compliant: true` (fail open) |
| Validador lança erro de rede/API | `compliant: true` (fail open) |
| 3ª tentativa ainda não-compliant | Envia mesmo assim + `console.warn` com violation |
| Geração principal falha | Lança normalmente (BullMQ retry) |

## Arquivos Modificados

| Arquivo | Tipo de mudança |
|---------|----------------|
| `apps/worker/src/agents/agent-runner.ts` | Adicionar `validateResponse`, encapsular `generateText` em loop de até 3 tentativas |

## Fora do Escopo

- Configuração do número de tentativas via dashboard
- Log estruturado das violations no banco de dados
- Validação de mídia (apenas texto)
- Validação do histórico de mensagens anteriores
