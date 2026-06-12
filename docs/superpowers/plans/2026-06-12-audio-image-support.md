# Suporte a Áudio e Imagem — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer agentes processar mensagens de áudio (transcrição via Whisper para agentes OpenAI) e imagens (visão multimodal, com fallback automático para modelo vision se o configurado não suportar).

**Architecture:** O webhook extrai a `media_url` do payload e salva no banco. O worker pré-processa a mídia antes de chamar `runAgent`: para áudio, transcreve via Whisper e substitui o conteúdo; para imagem, busca o base64 via Evolution API e passa como `imageContent`. O `agent-runner` constrói a mensagem multimodal e troca o modelo se necessário.

**Tech Stack:** Zod (schema), Fastify (webhook), BullMQ worker, Vercel AI SDK (`generateText` com `ImagePart`), OpenAI Whisper API via `fetch`, Evolution API (`getBase64FromMediaMessage`)

---

## Mapa de arquivos

| Arquivo | Mudança |
|---------|---------|
| `packages/shared/src/schemas/evolution.ts` | Adicionar `url` em `audioMessage` e `imageMessage` |
| `packages/shared/src/schemas/__tests__/evolution.test.ts` | **Novo** — testes de schema |
| `apps/api/src/routes/webhooks/evolution.ts` | Exportar `extractMessageContent`, retornar `mediaUrl`, passá-la ao `saveMessage` |
| `apps/api/src/routes/webhooks/__tests__/evolution.test.ts` | **Novo** — testes de extração |
| `apps/worker/src/workers/process-message.ts` | Adicionar helpers e blocos de pré-processamento de mídia |
| `apps/worker/src/workers/__tests__/process-message.test.ts` | **Novo** — testes dos helpers |
| `apps/worker/src/agents/agent-runner.ts` | Suporte a `imageContent` multimodal, constants de visão |
| `apps/worker/src/agents/__tests__/agent-runner.test.ts` | Adicionar testes de visão |

---

## Task 1: Atualizar schema Evolution para capturar URLs de mídia

**Files:**
- Modify: `packages/shared/src/schemas/evolution.ts`
- Create: `packages/shared/src/schemas/__tests__/evolution.test.ts`

- [ ] **Step 1: Criar teste que falha**

Criar o arquivo `packages/shared/src/schemas/__tests__/evolution.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { evolutionWebhookPayloadSchema } from "../evolution";

const basePayload = {
  event: "messages.upsert",
  instance: "my-instance",
  data: {
    key: { remoteJid: "5511999999999@s.whatsapp.net", fromMe: false, id: "MSG1" },
    messageType: "audioMessage",
  },
};

describe("evolutionWebhookPayloadSchema — campos de URL de mídia", () => {
  it("captura audioMessage.url", () => {
    const result = evolutionWebhookPayloadSchema.safeParse({
      ...basePayload,
      data: {
        ...basePayload.data,
        message: { audioMessage: { url: "https://cdn.example.com/audio.ogg" } },
      },
    });
    expect(result.success).toBe(true);
    expect(result.data?.data.message?.audioMessage?.url).toBe(
      "https://cdn.example.com/audio.ogg"
    );
  });

  it("captura imageMessage.url e caption juntos", () => {
    const result = evolutionWebhookPayloadSchema.safeParse({
      ...basePayload,
      data: {
        ...basePayload.data,
        messageType: "imageMessage",
        message: {
          imageMessage: {
            url: "https://cdn.example.com/photo.jpg",
            caption: "veja isso",
          },
        },
      },
    });
    expect(result.success).toBe(true);
    expect(result.data?.data.message?.imageMessage?.url).toBe(
      "https://cdn.example.com/photo.jpg"
    );
    expect(result.data?.data.message?.imageMessage?.caption).toBe("veja isso");
  });

  it("aceita audioMessage sem url (campo opcional)", () => {
    const result = evolutionWebhookPayloadSchema.safeParse({
      ...basePayload,
      data: {
        ...basePayload.data,
        message: { audioMessage: {} },
      },
    });
    expect(result.success).toBe(true);
    expect(result.data?.data.message?.audioMessage?.url).toBeUndefined();
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
pnpm --filter @aula-agente/shared test
```

Esperado: FAIL — `audioMessage.url` não existe no schema atual.

- [ ] **Step 3: Adicionar campo `url` ao schema**

Em `packages/shared/src/schemas/evolution.ts`, substituir:

```ts
imageMessage: z.object({ caption: z.string().optional() }).optional(),
audioMessage: z.object({}).optional(),
```

por:

```ts
imageMessage: z
  .object({ caption: z.string().optional(), url: z.string().optional() })
  .optional(),
audioMessage: z.object({ url: z.string().optional() }).optional(),
```

- [ ] **Step 4: Rodar e confirmar que passa**

```bash
pnpm --filter @aula-agente/shared test
```

Esperado: 3 testes PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/schemas/evolution.ts packages/shared/src/schemas/__tests__/evolution.test.ts
git commit -m "feat: adicionar campo url nos sub-schemas de audioMessage e imageMessage"
```

---

## Task 2: Extrair e salvar media_url no webhook handler

**Files:**
- Modify: `apps/api/src/routes/webhooks/evolution.ts`
- Create: `apps/api/src/routes/webhooks/__tests__/evolution.test.ts`

- [ ] **Step 1: Criar teste que falha**

Criar `apps/api/src/routes/webhooks/__tests__/evolution.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { extractMessageContent } from "../evolution";

describe("extractMessageContent", () => {
  it("extrai url de audioMessage", () => {
    const data = {
      messageType: "audioMessage",
      message: { audioMessage: { url: "https://cdn.example.com/audio.ogg" } },
    };
    const result = extractMessageContent(data as Record<string, unknown>);
    expect(result.content).toBe("[áudio]");
    expect(result.mediaType).toBe("audio");
    expect(result.mediaUrl).toBe("https://cdn.example.com/audio.ogg");
  });

  it("extrai url e caption de imageMessage", () => {
    const data = {
      messageType: "imageMessage",
      message: {
        imageMessage: { url: "https://cdn.example.com/photo.jpg", caption: "olha isso" },
      },
    };
    const result = extractMessageContent(data as Record<string, unknown>);
    expect(result.content).toBe("olha isso");
    expect(result.mediaType).toBe("image");
    expect(result.mediaUrl).toBe("https://cdn.example.com/photo.jpg");
  });

  it("retorna mediaUrl null para mensagem de texto", () => {
    const data = {
      messageType: "conversation",
      message: { conversation: "oi" },
    };
    const result = extractMessageContent(data as Record<string, unknown>);
    expect(result.mediaUrl).toBeNull();
  });

  it("retorna mediaUrl null quando audioMessage não tem url", () => {
    const data = {
      messageType: "audioMessage",
      message: { audioMessage: {} },
    };
    const result = extractMessageContent(data as Record<string, unknown>);
    expect(result.mediaUrl).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
pnpm --filter @aula-agente/api test
```

Esperado: FAIL — `extractMessageContent` não está exportada e não retorna `mediaUrl`.

- [ ] **Step 3: Exportar a função e adicionar mediaUrl ao retorno**

Em `apps/api/src/routes/webhooks/evolution.ts`, substituir a assinatura e o corpo de `extractMessageContent`:

```ts
export function extractMessageContent(data: Record<string, unknown>): {
  content: string;
  mediaType: MediaType | null;
  mediaUrl: string | null;
} {
  const message = data.message as Record<string, unknown> | undefined;
  const messageType = data.messageType as string;

  if (!message) return { content: "", mediaType: null, mediaUrl: null };

  switch (messageType) {
    case "conversation":
      return { content: (message.conversation as string) || "", mediaType: null, mediaUrl: null };
    case "imageMessage": {
      const img = message.imageMessage as Record<string, string> | undefined;
      return {
        content: img?.caption || "[imagem]",
        mediaType: "image",
        mediaUrl: img?.url ?? null,
      };
    }
    case "audioMessage": {
      const audio = message.audioMessage as Record<string, string> | undefined;
      return { content: "[áudio]", mediaType: "audio", mediaUrl: audio?.url ?? null };
    }
    case "videoMessage":
      return {
        content: (message.videoMessage as Record<string, string>)?.caption || "[vídeo]",
        mediaType: "video",
        mediaUrl: null,
      };
    case "documentMessage":
      return {
        content: (message.documentMessage as Record<string, string>)?.fileName || "[documento]",
        mediaType: "document",
        mediaUrl: null,
      };
    case "stickerMessage":
      return { content: "[sticker]", mediaType: "sticker", mediaUrl: null };
    case "locationMessage": {
      const loc = message.locationMessage as Record<string, number> | undefined;
      return {
        content: `[localização: ${loc?.degreesLatitude}, ${loc?.degreesLongitude}]`,
        mediaType: "location",
        mediaUrl: null,
      };
    }
    default:
      return { content: "", mediaType: null, mediaUrl: null };
  }
}
```

- [ ] **Step 4: Passar mediaUrl ao saveMessage no handler**

Ainda em `evolution.ts`, no bloco do handler, substituir:

```ts
const { content, mediaType } = extractMessageContent(payload.data as Record<string, unknown>);

const message = await saveMessage({
  conversationId: conversation.id,
  organizationId,
  evolutionMessageId,
  role: "contact",
  content,
  mediaType,
});
```

por:

```ts
const { content, mediaType, mediaUrl } = extractMessageContent(payload.data as Record<string, unknown>);

const message = await saveMessage({
  conversationId: conversation.id,
  organizationId,
  evolutionMessageId,
  role: "contact",
  content,
  mediaType,
  mediaUrl,
});
```

- [ ] **Step 5: Rodar e confirmar que passa**

```bash
pnpm --filter @aula-agente/api test
```

Esperado: 4 testes PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/webhooks/evolution.ts apps/api/src/routes/webhooks/__tests__/evolution.test.ts
git commit -m "feat: extrair e salvar media_url de mensagens de áudio e imagem"
```

---

## Task 3: Adicionar helpers de mídia e pré-processamento de áudio ao worker

**Files:**
- Modify: `apps/worker/src/workers/process-message.ts`
- Create: `apps/worker/src/workers/__tests__/process-message.test.ts`

- [ ] **Step 1: Criar teste que falha**

Criar `apps/worker/src/workers/__tests__/process-message.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  fetchMediaBase64,
  transcribeAudio,
  preprocessAudioMessage,
} from "../process-message";
import type { Message } from "@aula-agente/shared";

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
  process.env.EVOLUTION_API_URL = "http://evolution.local";
  process.env.EVOLUTION_API_KEY = "test-evo-key";
});

afterEach(() => {
  vi.restoreAllMocks();
  mockFetch.mockReset();
});

const audioMessage: Message = {
  id: "msg-1",
  conversation_id: "conv-1",
  organization_id: "org-1",
  evolution_message_id: "EVO123",
  role: "contact",
  content: "[áudio]",
  media_url: null,
  media_type: "audio",
  metadata: null,
  created_at: "2026-06-12T00:00:00Z",
};

describe("fetchMediaBase64", () => {
  it("chama Evolution API e retorna base64 e mimeType", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ base64: "dGVzdA==", mimetype: "audio/ogg; codecs=opus" }),
    });

    const result = await fetchMediaBase64(
      "my-instance",
      "5511999@s.whatsapp.net",
      "EVO123",
      "audioMessage"
    );

    expect(mockFetch).toHaveBeenCalledWith(
      "http://evolution.local/chat/getBase64FromMediaMessage/my-instance",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ apikey: "test-evo-key" }),
        body: expect.stringContaining("EVO123"),
      })
    );
    expect(result.base64).toBe("dGVzdA==");
    expect(result.mimeType).toBe("audio/ogg; codecs=opus");
  });

  it("lança quando Evolution API retorna status não-ok", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, text: async () => "not found" });
    await expect(
      fetchMediaBase64("instance", "jid", "id", "audioMessage")
    ).rejects.toThrow("Evolution API error");
  });
});

describe("transcribeAudio", () => {
  it("chama OpenAI Whisper e retorna o texto transcrito", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ text: "olá, tudo bem?" }),
    });

    const result = await transcribeAudio("dGVzdA==", "audio/ogg", "sk-openai-key");

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.openai.com/v1/audio/transcriptions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer sk-openai-key" }),
      })
    );
    expect(result).toBe("olá, tudo bem?");
  });

  it("lança quando Whisper retorna status não-ok", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, text: async () => "quota exceeded" });
    await expect(
      transcribeAudio("dGVzdA==", "audio/ogg", "sk-key")
    ).rejects.toThrow();
  });
});

describe("preprocessAudioMessage", () => {
  it("retorna mensagem com transcrição para provider openai", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ base64: "dGVzdA==", mimetype: "audio/ogg" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ text: "mensagem transcrita" }),
      });

    const result = await preprocessAudioMessage(
      audioMessage,
      "my-instance",
      "5511999",
      "openai",
      "sk-key"
    );

    expect(result.content).toBe("mensagem transcrita");
  });

  it("retorna fallback textual para provider não-openai", async () => {
    const result = await preprocessAudioMessage(
      audioMessage,
      "my-instance",
      "5511999",
      "anthropic",
      "sk-ant-key"
    );

    expect(result.content).toBe(
      "[Usuário enviou um áudio. Transcrição não disponível para este agente.]"
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("retorna fallback de erro quando fetchMediaBase64 falha", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, text: async () => "error" });

    const result = await preprocessAudioMessage(
      audioMessage,
      "my-instance",
      "5511999",
      "openai",
      "sk-key"
    );

    expect(result.content).toBe(
      "[Usuário enviou um áudio. Não foi possível processar.]"
    );
  });

  it("retorna mensagem original se evolution_message_id for null", async () => {
    const msg = { ...audioMessage, evolution_message_id: null };
    const result = await preprocessAudioMessage(msg, "inst", "5511", "openai", "sk");
    expect(result).toBe(msg);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
pnpm --filter @aula-agente/worker test
```

Esperado: FAIL — funções não existem.

- [ ] **Step 3: Adicionar constantes e helpers no topo de process-message.ts**

Em `apps/worker/src/workers/process-message.ts`, adicionar logo após os imports:

```ts
import type { LLMProvider } from "@aula-agente/shared";

const EVOLUTION_API_URL = () => process.env.EVOLUTION_API_URL!;
const EVOLUTION_API_KEY = () => process.env.EVOLUTION_API_KEY!;

export async function fetchMediaBase64(
  instanceName: string,
  remoteJid: string,
  messageId: string,
  messageType: string
): Promise<{ base64: string; mimeType: string }> {
  const response = await fetch(
    `${EVOLUTION_API_URL()}/chat/getBase64FromMediaMessage/${encodeURIComponent(instanceName)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: EVOLUTION_API_KEY(),
      },
      body: JSON.stringify({
        message: {
          key: { remoteJid, fromMe: false, id: messageId },
          messageType,
        },
      }),
    }
  );
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Evolution API error ${response.status}: ${text}`);
  }
  const json = await response.json() as { base64: string; mimetype: string };
  return { base64: json.base64, mimeType: json.mimetype };
}

export async function transcribeAudio(
  base64: string,
  mimeType: string,
  apiKey: string
): Promise<string> {
  const audioBuffer = Buffer.from(base64, "base64");
  const audioBlob = new Blob([audioBuffer], { type: mimeType });
  const formData = new FormData();
  formData.append("file", audioBlob, "audio.ogg");
  formData.append("model", "whisper-1");

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Whisper API error ${response.status}: ${text}`);
  }
  const json = await response.json() as { text: string };
  return json.text;
}

export async function preprocessAudioMessage(
  message: Message,
  instanceName: string,
  phone: string,
  provider: LLMProvider,
  apiKey: string
): Promise<Message> {
  if (!message.evolution_message_id) return message;

  const remoteJid = `${phone}@s.whatsapp.net`;

  if (provider !== "openai") {
    return {
      ...message,
      content: "[Usuário enviou um áudio. Transcrição não disponível para este agente.]",
    };
  }

  try {
    const { base64, mimeType } = await fetchMediaBase64(
      instanceName,
      remoteJid,
      message.evolution_message_id,
      "audioMessage"
    );
    const transcription = await transcribeAudio(base64, mimeType, apiKey);
    return { ...message, content: transcription };
  } catch (err) {
    console.warn("[process-message] Falha ao processar áudio:", (err as Error).message);
    return { ...message, content: "[Usuário enviou um áudio. Não foi possível processar.]" };
  }
}
```

Adicionar `Message` ao import existente de `@aula-agente/shared` no topo do arquivo:

```ts
import type { Message } from "@aula-agente/shared";
```

(Se já estiver importado via outro alias, adaptar.)

- [ ] **Step 4: Rodar e confirmar que passa**

```bash
pnpm --filter @aula-agente/worker test
```

Esperado: todos os novos testes PASS (os testes existentes de send-message não devem quebrar).

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/workers/process-message.ts apps/worker/src/workers/__tests__/process-message.test.ts
git commit -m "feat: adicionar helpers fetchMediaBase64, transcribeAudio e preprocessAudioMessage"
```

---

## Task 4: Adicionar pré-processamento de imagem e integrar ao job handler

**Files:**
- Modify: `apps/worker/src/workers/process-message.ts`
- Modify: `apps/worker/src/workers/__tests__/process-message.test.ts`

- [ ] **Step 1: Adicionar testes para preprocessImageMessage**

Adicionar ao final de `apps/worker/src/workers/__tests__/process-message.test.ts`:

```ts
import { preprocessImageMessage } from "../process-message";

const imageMessage: Message = {
  id: "msg-2",
  conversation_id: "conv-1",
  organization_id: "org-1",
  evolution_message_id: "EVO456",
  role: "contact",
  content: "[imagem]",
  media_url: null,
  media_type: "image",
  metadata: null,
  created_at: "2026-06-12T00:00:00Z",
};

describe("preprocessImageMessage", () => {
  it("retorna base64 e mimeType da imagem quando fetch tem sucesso", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ base64: "imgBase64==", mimetype: "image/jpeg" }),
    });

    const result = await preprocessImageMessage(imageMessage, "my-instance", "5511999");

    expect(result).toEqual({ base64: "imgBase64==", mimeType: "image/jpeg" });
  });

  it("retorna null quando fetchMediaBase64 falha", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, text: async () => "error" });

    const result = await preprocessImageMessage(imageMessage, "my-instance", "5511999");

    expect(result).toBeNull();
  });

  it("retorna null quando evolution_message_id é null", async () => {
    const msg = { ...imageMessage, evolution_message_id: null };
    const result = await preprocessImageMessage(msg, "inst", "5511");
    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
pnpm --filter @aula-agente/worker test
```

Esperado: FAIL — `preprocessImageMessage` não existe.

- [ ] **Step 3: Adicionar preprocessImageMessage ao process-message.ts**

Logo após `preprocessAudioMessage`, adicionar:

```ts
export async function preprocessImageMessage(
  message: Message,
  instanceName: string,
  phone: string
): Promise<{ base64: string; mimeType: string } | null> {
  if (!message.evolution_message_id) return null;

  const remoteJid = `${phone}@s.whatsapp.net`;
  try {
    const { base64, mimeType } = await fetchMediaBase64(
      instanceName,
      remoteJid,
      message.evolution_message_id,
      "imageMessage"
    );
    return { base64, mimeType };
  } catch (err) {
    console.warn("[process-message] Falha ao buscar imagem:", (err as Error).message);
    return null;
  }
}
```

- [ ] **Step 4: Integrar os preprocessors e mover instance/phone para antes de runAgent**

No corpo do job handler de `startProcessMessageWorker`, substituir o bloco que vai desde o carregamento de mensagens até `runAgent`:

**Antes** (linhas aproximadas 52–70):
```ts
// Load recent message history
const recentMessages = await getRecentMessages(db, conversationId, 20);

// Find the current message
const currentMessage = recentMessages.find((m) => m.id === messageId);
if (!currentMessage) {
  throw new Error(`Message ${messageId} not found`);
}

// Remove current message from history
const history = recentMessages.filter((m) => m.id !== messageId);

// Run the agent
const result = await runAgent({
  agent,
  messages: history,
  currentMessage,
  apiKey,
  organizationId,
});
```

**Depois:**
```ts
// Load recent message history
const recentMessages = await getRecentMessages(db, conversationId, 20);

// Find the current message
const currentMessage = recentMessages.find((m) => m.id === messageId);
if (!currentMessage) {
  throw new Error(`Message ${messageId} not found`);
}

// Remove current message from history
const history = recentMessages.filter((m) => m.id !== messageId);

// Extract phone and instance early (needed for media preprocessing and sending)
const contact = conversation.contacts as { phone: string } | null;
if (!contact?.phone) {
  throw new Error(`Contact phone not found for conversation ${conversationId}`);
}
const instance = await getInstanceById(db, conversation.evolution_instance_id as string);

// Media preprocessing
let effectiveMessage = currentMessage;
let imageContent: { base64: string; mimeType: string } | undefined;

if (currentMessage.media_type === "audio") {
  effectiveMessage = await preprocessAudioMessage(
    currentMessage,
    instance.instance_name,
    contact.phone,
    agent.provider,
    apiKey
  );
} else if (currentMessage.media_type === "image") {
  const result = await preprocessImageMessage(
    currentMessage,
    instance.instance_name,
    contact.phone
  );
  if (result) imageContent = result;
}

// Run the agent
const result = await runAgent({
  agent,
  messages: history,
  currentMessage: effectiveMessage,
  apiKey,
  organizationId,
  imageContent,
});
```

Remover as linhas que buscavam `instance` e `contact` no trecho posterior (que agora são redundantes) — as linhas que faziam:
```ts
const instance = await getInstanceById(db, conversation.evolution_instance_id as string);
const contact = conversation.contacts as { phone: string } | null;
if (!contact?.phone) { throw ... }
```

- [ ] **Step 5: Rodar e confirmar que passa**

```bash
pnpm --filter @aula-agente/worker test
```

Esperado: todos os testes PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/workers/process-message.ts apps/worker/src/workers/__tests__/process-message.test.ts
git commit -m "feat: adicionar preprocessImageMessage e integrar pré-processamento de mídia ao job handler"
```

---

## Task 5: Suporte a imagem multimodal no agent-runner

**Files:**
- Modify: `apps/worker/src/agents/agent-runner.ts`
- Modify: `apps/worker/src/agents/__tests__/agent-runner.test.ts`

- [ ] **Step 1: Adicionar testes de visão ao arquivo existente**

Abrir `apps/worker/src/agents/__tests__/agent-runner.test.ts` e adicionar um novo `describe` ao final:

```ts
import { createOpenAI } from "@ai-sdk/openai";

// Adicionar este bloco de mock no topo junto aos outros vi.mock:
vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: vi.fn(),
}));

// Adicionar este describe ao final do arquivo:
describe("runAgent — suporte a imagem multimodal", () => {
  const imageContent = { base64: "aW1hZ2U=", mimeType: "image/jpeg" };

  beforeEach(() => {
    const mockModel = {};
    const mockCallable = vi.fn().mockReturnValue(mockModel);
    vi.mocked(createOpenAI).mockReturnValue(mockCallable as any);

    vi.mocked(generateText).mockResolvedValue({
      text: "resposta sobre a imagem",
      usage: { totalTokens: 30 },
      steps: [],
    } as any);
  });

  it("inclui image part na mensagem quando imageContent é fornecido", async () => {
    await runAgent({
      agent: { ...mockAgent, model: "gpt-4o", provider: "openai" },
      messages: [],
      currentMessage: { ...mockCurrentMessage, media_type: "image", content: "[imagem]" },
      apiKey: "sk-test",
      organizationId: "org-1",
      imageContent,
    });

    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: "user",
            content: expect.arrayContaining([
              expect.objectContaining({ type: "text", text: "[imagem]" }),
              expect.objectContaining({ type: "image" }),
            ]),
          }),
        ]),
      })
    );
  });

  it("usa modelo vision fallback (gpt-4o) quando modelo configurado não suporta visão (gpt-4.1-nano)", async () => {
    const mockCallable = vi.mocked(createOpenAI).mock.results[0]?.value as ReturnType<typeof vi.fn>;

    await runAgent({
      agent: { ...mockAgent, model: "gpt-4.1-nano", provider: "openai" },
      messages: [],
      currentMessage: { ...mockCurrentMessage, media_type: "image", content: "[imagem]" },
      apiKey: "sk-test",
      organizationId: "org-1",
      imageContent,
    });

    // O callable (provider function) deve ter sido chamado com "gpt-4o" (fallback)
    expect(mockCallable).toHaveBeenCalledWith("gpt-4o");
  });

  it("sem imageContent, mensagem é texto simples (comportamento inalterado)", async () => {
    await runAgent({
      agent: { ...mockAgent, model: "gpt-4o", provider: "openai" },
      messages: [],
      currentMessage: mockCurrentMessage,
      apiKey: "sk-test",
      organizationId: "org-1",
    });

    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: "user",
            content: mockCurrentMessage.content,
          }),
        ]),
      })
    );
  });
});
```

**Nota:** Os mocks exatos de `createOpenAI` precisam ser consistentes com o estilo já usado no arquivo. Se o arquivo já mocka `@ai-sdk/openai` de outra forma, adaptar sem duplicar.

- [ ] **Step 2: Rodar e confirmar que os novos testes falham**

```bash
pnpm --filter @aula-agente/worker test
```

Esperado: 3 novos testes FAIL — `imageContent` param e multimodal não implementados ainda.

- [ ] **Step 3: Adicionar constantes de visão ao agent-runner.ts**

Em `apps/worker/src/agents/agent-runner.ts`, logo após `const MAX_ATTEMPTS = 3;`, adicionar:

```ts
const NON_VISION_MODELS = new Set(["gpt-4.1-nano"]);

const VISION_FALLBACK_MODELS: Record<LLMProvider, string> = {
  openai: "gpt-4o",
  anthropic: "claude-sonnet-4-20250514",
  google: "gemini-2.0-flash",
};
```

- [ ] **Step 4: Adicionar imageContent à interface RunAgentParams**

Substituir:

```ts
interface RunAgentParams {
  agent: Agent;
  messages: Message[];
  currentMessage: Message;
  apiKey: string;
  organizationId: string;
}
```

por:

```ts
interface RunAgentParams {
  agent: Agent;
  messages: Message[];
  currentMessage: Message;
  apiKey: string;
  organizationId: string;
  imageContent?: { base64: string; mimeType: string };
}
```

- [ ] **Step 5: Usar effectiveModel e mensagem multimodal no runAgent**

No corpo de `runAgent`, após `const model = createModel(agent.provider, agent.model, apiKey);`, adicionar:

```ts
const { imageContent } = params;
const useVisionFallback = !!imageContent && NON_VISION_MODELS.has(agent.model);
const effectiveModel = useVisionFallback
  ? createModel(agent.provider, VISION_FALLBACK_MODELS[agent.provider], apiKey)
  : model;

const currentUserContent = imageContent
  ? [
      { type: "text" as const, text: currentMessage.content },
      {
        type: "image" as const,
        image: Buffer.from(imageContent.base64, "base64"),
        mimeType: imageContent.mimeType,
      },
    ]
  : currentMessage.content;
```

Dentro do loop `for (let attempt = 1; ...)`, substituir a chamada `generateText`:

```ts
const result = await generateText({
  model,                              // ← trocar para:
  ...
});
```

por:

```ts
const result = await generateText({
  model: effectiveModel,
  system: systemPrompt,
  messages: [
    ...history,
    { role: "user", content: currentUserContent },
  ],
  tools,
  maxSteps: agent.max_steps,
  temperature: agent.temperature,
  maxTokens: agent.max_tokens,
});
```

- [ ] **Step 6: Rodar e confirmar que todos os testes passam**

```bash
pnpm --filter @aula-agente/worker test
```

Esperado: todos os testes (existentes + novos) PASS.

- [ ] **Step 7: Typecheck geral**

```bash
pnpm --filter @aula-agente/worker typecheck
pnpm --filter @aula-agente/api typecheck
pnpm --filter @aula-agente/shared typecheck
```

Esperado: sem erros de tipo.

- [ ] **Step 8: Commit**

```bash
git add apps/worker/src/agents/agent-runner.ts apps/worker/src/agents/__tests__/agent-runner.test.ts
git commit -m "feat: suporte a imagem multimodal no agent-runner com fallback automático para modelo vision"
```

---

## Self-Review

**Spec coverage:**
- ✅ Schema — `url` adicionado em `audioMessage` e `imageMessage` (Task 1)
- ✅ Webhook — `extractMessageContent` retorna `mediaUrl`, passado ao `saveMessage` (Task 2)
- ✅ `fetchMediaBase64` — chama Evolution API `getBase64FromMediaMessage` (Task 3)
- ✅ `transcribeAudio` — chama Whisper com FormData (Task 3)
- ✅ Audio: OpenAI → transcrição, outros → fallback textual (Task 3)
- ✅ Audio: fallback de erro quando fetch falha (Task 3)
- ✅ `preprocessImageMessage` — busca base64 da imagem (Task 4)
- ✅ Integração ao job handler — instance/phone movidos, preprocessors chamados (Task 4)
- ✅ `NON_VISION_MODELS` e `VISION_FALLBACK_MODELS` (Task 5)
- ✅ `RunAgentParams.imageContent` (Task 5)
- ✅ `effectiveModel` troca modelo para non-vision (Task 5)
- ✅ `currentUserContent` multimodal com image part (Task 5)
- ✅ Sem `imageContent` → comportamento inalterado (Task 5)

**Placeholder scan:** Nenhum TBD ou TODO encontrado.

**Type consistency:**
- `fetchMediaBase64` retorna `{ base64, mimeType }` — usado assim em `preprocessAudioMessage`, `preprocessImageMessage` e Task 4 ✅
- `imageContent: { base64: string; mimeType: string }` definido em `RunAgentParams` e usado em `currentUserContent` ✅
- `preprocessAudioMessage` retorna `Message` — atribuído a `effectiveMessage: Message` ✅
- `preprocessImageMessage` retorna `{ base64, mimeType } | null` — `if (result) imageContent = result` ✅
