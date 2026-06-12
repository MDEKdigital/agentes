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
