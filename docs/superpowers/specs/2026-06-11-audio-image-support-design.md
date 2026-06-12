# Suporte a Áudio e Imagem — Design Spec

## Visão geral

Quando um cliente envia um áudio ou imagem via WhatsApp, o agente atualmente recebe apenas `"[áudio]"` ou `"[imagem]"` como conteúdo da mensagem, impedindo qualquer resposta contextual. Este spec resolve os dois problemas em camadas:

1. **Extração de `media_url`** no webhook — salvar a URL de mídia recebida do Evolution API no banco
2. **Transcrição de áudio** via OpenAI Whisper — apenas para agentes OpenAI; fallback textual para Anthropic/Google
3. **Visão para imagens** — passar o conteúdo visual ao LLM multimodal; se o modelo configurado não suportar visão, trocar temporariamente para um modelo vision do mesmo provider

## Escopo

4 arquivos modificados. Nenhuma nova dependência de pacote.

| Arquivo | Tipo de mudança |
|---------|----------------|
| `packages/shared/src/schemas/evolution.ts` | Adicionar campo `url` nos sub-schemas de áudio e imagem |
| `apps/api/src/routes/webhooks/evolution.ts` | Extrair e salvar `media_url` |
| `apps/worker/src/workers/process-message.ts` | Pré-processar mídia antes de chamar `runAgent` |
| `apps/worker/src/agents/agent-runner.ts` | Suporte a mensagem multimodal com imagem |

---

## Seção 1 — Foundation: Extração de media_url

### Schema (`packages/shared/src/schemas/evolution.ts`)

Adicionar `url: z.string().optional()` nos sub-schemas `audioMessage` e `imageMessage`:

```ts
audioMessage: z.object({ url: z.string().optional() }).optional(),
imageMessage: z.object({ caption: z.string().optional(), url: z.string().optional() }).optional(),
```

Os outros tipos de mensagem permanecem inalterados.

### Webhook (`apps/api/src/routes/webhooks/evolution.ts`)

`extractMessageContent` passa a retornar `{ content, mediaType, mediaUrl }`:

```ts
function extractMessageContent(data: Record<string, unknown>): {
  content: string;
  mediaType: MediaType | null;
  mediaUrl: string | null;
}
```

Por tipo de mensagem:
- `audioMessage`: `mediaUrl = (message.audioMessage as Record<string, string>)?.url ?? null`
- `imageMessage`: `mediaUrl = (message.imageMessage as Record<string, string>)?.url ?? null`
- Todos os outros: `mediaUrl = null`

O campo é passado ao `saveMessage`:

```ts
const { content, mediaType, mediaUrl } = extractMessageContent(payload.data as Record<string, unknown>);
await saveMessage({ ..., mediaType, mediaUrl });
```

`saveMessage` já aceita `mediaUrl?: string | null` — nenhuma mudança no service.

---

## Seção 2 — Áudio: Transcrição via OpenAI Whisper

### Helpers novos em `process-message.ts`

#### `fetchMediaBase64`

```ts
async function fetchMediaBase64(
  instanceName: string,
  remoteJid: string,
  messageId: string,
  messageType: string
): Promise<{ base64: string; mimeType: string }>
```

Chama `POST {EVOLUTION_API_URL}/chat/getBase64FromMediaMessage/{instanceName}` com headers `apikey: EVOLUTION_API_KEY` e body:

```json
{
  "message": {
    "key": { "remoteJid": "<remoteJid>", "fromMe": false, "id": "<messageId>" },
    "messageType": "<messageType>"
  }
}
```

Lança em caso de resposta não-ok. O chamador envolve em try/catch.

#### `transcribeAudio`

```ts
async function transcribeAudio(
  base64: string,
  mimeType: string,
  apiKey: string
): Promise<string>
```

1. Decodifica `base64` → `Buffer`
2. Cria `Blob` com o buffer e `mimeType`
3. Monta `FormData` com campos `file` (o Blob, nome `"audio.ogg"`) e `model = "whisper-1"`
4. `POST https://api.openai.com/v1/audio/transcriptions` com header `Authorization: Bearer {apiKey}`
5. Retorna `json.text`

### Fluxo em `process-message.ts`

Antes de chamar `runAgent`, mover a extração de `phone` e `instance` para antes do bloco de mídia:

```ts
// Extrair phone antes do bloco de mídia
const contact = conversation.contacts as { phone: string } | null;
if (!contact?.phone) throw new Error(`Contact phone not found for conversation ${conversationId}`);

// Carregar instance antes do bloco de mídia
const instance = await getInstanceById(db, conversation.evolution_instance_id as string);
```

Bloco de pré-processamento de mídia (inserir entre o carregamento de `currentMessage` e a chamada a `runAgent`):

```ts
let effectiveMessage = currentMessage;
const remoteJid = `${contact.phone}@s.whatsapp.net`;

if (currentMessage.media_type === "audio" && currentMessage.evolution_message_id) {
  try {
    const { base64, mimeType } = await fetchMediaBase64(
      instance.instance_name,
      remoteJid,
      currentMessage.evolution_message_id,
      "audioMessage"
    );
    let transcription: string;
    if (agent.provider === "openai") {
      transcription = await transcribeAudio(base64, mimeType, apiKey);
    } else {
      transcription = "[Usuário enviou um áudio. Transcrição não disponível para este agente.]";
    }
    effectiveMessage = { ...currentMessage, content: transcription };
  } catch (err) {
    console.warn("[process-message] Falha ao processar áudio:", (err as Error).message);
    effectiveMessage = {
      ...currentMessage,
      content: "[Usuário enviou um áudio. Não foi possível processar.]",
    };
  }
}
```

Passar `effectiveMessage` ao `runAgent`:

```ts
const result = await runAgent({
  agent,
  messages: history,
  currentMessage: effectiveMessage,
  apiKey,
  organizationId,
});
```

---

## Seção 3 — Imagem: Visão multimodal

### Fluxo em `process-message.ts`

Bloco de imagem (inserir imediatamente após o bloco de áudio):

```ts
let imageContent: { base64: string; mimeType: string } | undefined;

if (currentMessage.media_type === "image" && currentMessage.evolution_message_id) {
  try {
    const { base64, mimeType } = await fetchMediaBase64(
      instance.instance_name,
      remoteJid,
      currentMessage.evolution_message_id,
      "imageMessage"
    );
    imageContent = { base64, mimeType };
  } catch (err) {
    console.warn("[process-message] Falha ao buscar imagem:", (err as Error).message);
    // imageContent permanece undefined — runAgent processa só o texto
  }
}
```

Passar `imageContent` ao `runAgent`:

```ts
const result = await runAgent({
  agent,
  messages: history,
  currentMessage: effectiveMessage,
  apiKey,
  organizationId,
  imageContent,
});
```

### Constantes novas em `agent-runner.ts`

```ts
const NON_VISION_MODELS = new Set(["gpt-4.1-nano"]);

const VISION_FALLBACK_MODELS: Record<LLMProvider, string> = {
  openai: "gpt-4o",
  anthropic: "claude-sonnet-4-20250514",
  google: "gemini-2.0-flash",
};
```

### Interface `RunAgentParams` (agent-runner.ts)

```ts
interface RunAgentParams {
  agent: Agent;
  messages: Message[];
  currentMessage: Message;
  apiKey: string;
  organizationId: string;
  imageContent?: { base64: string; mimeType: string }; // novo
}
```

### Lógica de visão em `runAgent`

No início de `runAgent`, após criar `model`:

```ts
const useVisionFallback = !!imageContent && NON_VISION_MODELS.has(agent.model);
const effectiveModel = useVisionFallback
  ? createModel(agent.provider, VISION_FALLBACK_MODELS[agent.provider], apiKey)
  : model;
```

Dentro do loop de tentativas, substituir a linha:

```ts
{ role: "user", content: currentMessage.content }
```

por:

```ts
{
  role: "user",
  content: imageContent
    ? [
        { type: "text" as const, text: currentMessage.content },
        { type: "image" as const, image: Buffer.from(imageContent.base64, "base64"), mimeType: imageContent.mimeType },
      ]
    : currentMessage.content,
}
```

E substituir `model` por `effectiveModel` no `generateText`:

```ts
const result = await generateText({
  model: effectiveModel,
  ...
});
```

O `effectiveModel` é usado para TODAS as tentativas do loop — o validador continua usando `VALIDATION_MODELS[provider]` (sem visão, recebe só texto).

---

## Tratamento de erros

| Situação | Comportamento |
|----------|--------------|
| `fetchMediaBase64` falha (rede, 404, expirado) | `console.warn` + fallback textual / `imageContent` undefined |
| `transcribeAudio` falha (Whisper error, quota) | `console.warn` + "[Usuário enviou um áudio. Não foi possível processar.]" |
| `evolution_message_id` ausente na mensagem | Pula bloco de mídia, usa `currentMessage` original |
| Imagem: `fetchMediaBase64` falha | `runAgent` sem `imageContent` — processa só caption/texto |

## Fora do escopo

- Transcrição de áudio para Anthropic/Google
- Cache de base64 de mídia (fetch a cada processamento)
- Suporte a vídeo e documento (mantém `"[vídeo]"` / `"[documento]"`)
- Armazenamento permanente de imagens (Supabase Storage)
- `media_url` salvo no banco para exibição no dashboard (foundation salva, mas não é consumido ainda)
