import { describe, it, expect, vi } from "vitest";
import { getMessagesByConversation, getRecentMessages } from "../messages";

function makeClient(returnData: unknown[] = []) {
  const captured: Record<string, unknown> = {};
  const limitMock = vi.fn().mockResolvedValue({ data: returnData, error: null });
  const orderMock = vi.fn().mockReturnValue({ limit: limitMock });
  const eqMock = vi.fn().mockImplementation((field: string, val: unknown) => {
    captured[field] = val;
    return { eq: eqMock, order: orderMock };
  });
  return {
    client: {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({ eq: eqMock }),
      }),
    },
    captured,
  };
}

describe("getMessagesByConversation — V3 hardening", () => {
  it("filtra por conversation_id E organization_id", async () => {
    const { client, captured } = makeClient();
    await getMessagesByConversation(client as any, "conv-1", "org-a");
    expect(captured["conversation_id"]).toBe("conv-1");
    expect(captured["organization_id"]).toBe("org-a");
  });

  it("retorna mensagens quando org e conv batem", async () => {
    const msgs = [{ id: "m1", conversation_id: "conv-1", organization_id: "org-a" }];
    const { client } = makeClient(msgs);
    const result = await getMessagesByConversation(client as any, "conv-1", "org-a");
    expect(result).toEqual(msgs);
  });
});

describe("getRecentMessages — V3 hardening", () => {
  it("filtra por conversation_id E organization_id", async () => {
    const { client, captured } = makeClient();
    await getRecentMessages(client as any, "conv-1", "org-a");
    expect(captured["conversation_id"]).toBe("conv-1");
    expect(captured["organization_id"]).toBe("org-a");
  });

  it("inverte resultado DESC do DB para ordem ascendente (.reverse())", async () => {
    // DB retorna DESC: [m2 (newer), m1 (older)]; .reverse() → [m1, m2]
    const msgs = [
      { id: "m2", created_at: "2026-01-01T00:00:01Z" },
      { id: "m1", created_at: "2026-01-01T00:00:00Z" },
    ];
    const { client } = makeClient(msgs);
    const result = await getRecentMessages(client as any, "conv-1", "org-a");
    expect(result[0].id).toBe("m1");
    expect(result[1].id).toBe("m2");
  });
});
