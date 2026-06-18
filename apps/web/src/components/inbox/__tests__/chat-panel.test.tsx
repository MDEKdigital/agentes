import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import React from "react";

// ── hoisted mocks ─────────────────────────────────────────────────────────────
const { mockApiFetch, mockUseRealtime } = vi.hoisted(() => ({
  mockApiFetch: vi.fn(),
  mockUseRealtime: vi.fn(),
}));

vi.mock("@/lib/api", () => ({ apiFetch: mockApiFetch }));
vi.mock("@/lib/realtime", () => ({ useRealtime: mockUseRealtime }));

vi.mock("../message-bubble", () => ({
  MessageBubble: ({ message }: { message: { content: string } }) =>
    React.createElement("div", { "data-testid": "message" }, message.content),
}));

vi.mock("../side-panel", () => ({
  SidePanel: () => React.createElement("div", { "data-testid": "side-panel" }),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: any) =>
    React.createElement("button", props, children),
}));

vi.mock("@/components/ui/textarea", () => ({
  Textarea: (props: any) => React.createElement("textarea", props),
}));

vi.mock("lucide-react", () => ({
  Send: () => React.createElement("span", null, "send"),
}));

import { ChatPanel } from "../chat-panel";

// jsdom não implementa scrollIntoView — stub necessário
window.HTMLElement.prototype.scrollIntoView = vi.fn();

// ── fixtures ──────────────────────────────────────────────────────────────────
const CONV_ID = "conv-uuid-1";
const ORG_ID = "org-uuid-1";

const FULL_RESPONSE = {
  conversation: {
    id: CONV_ID,
    organization_id: ORG_ID,
    status: "open",
    is_human_takeover: false,
    assigned_to: null,
    tags: [],
    contacts: { phone: "+5511999999999", name: "João" },
  },
  messages: [
    { id: "msg-1", conversation_id: CONV_ID, role: "user", content: "Olá", created_at: "2026-01-01T00:00:00Z" },
    { id: "msg-2", conversation_id: CONV_ID, role: "assistant", content: "Oi!", created_at: "2026-01-01T00:00:01Z" },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockUseRealtime.mockReturnValue(undefined);
  mockApiFetch.mockResolvedValue(FULL_RESPONSE);
});

describe("ChatPanel — M1 (single /full request)", () => {
  it("T1: apiFetch chamado exatamente 1 vez ao montar", async () => {
    render(<ChatPanel conversationId={CONV_ID} onDelete={vi.fn()} />);

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledTimes(1);
    });
  });

  it("T2: a URL usada é /conversations/:id/full", async () => {
    render(<ChatPanel conversationId={CONV_ID} onDelete={vi.fn()} />);

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(`/conversations/${CONV_ID}/full`);
    });
  });

  it("T3: /conversations/:id separado NÃO é chamado", async () => {
    render(<ChatPanel conversationId={CONV_ID} onDelete={vi.fn()} />);

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalled();
    });

    const calls = mockApiFetch.mock.calls.map(([url]: [string]) => url);
    expect(calls.some((url) => url === `/conversations/${CONV_ID}`)).toBe(false);
  });

  it("T4: /conversations/:id/messages separado NÃO é chamado", async () => {
    render(<ChatPanel conversationId={CONV_ID} onDelete={vi.fn()} />);

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalled();
    });

    const calls = mockApiFetch.mock.calls.map(([url]: [string]) => url);
    expect(calls.some((url) => url === `/conversations/${CONV_ID}/messages`)).toBe(false);
  });

  it("T5: mensagens do response são renderizadas", async () => {
    render(<ChatPanel conversationId={CONV_ID} onDelete={vi.fn()} />);

    await waitFor(() => {
      const msgs = screen.getAllByTestId("message");
      expect(msgs).toHaveLength(2);
      expect(msgs[0]).toHaveTextContent("Olá");
      expect(msgs[1]).toHaveTextContent("Oi!");
    });
  });

  it("T6: nome do contato exibido no header da conversa", async () => {
    render(<ChatPanel conversationId={CONV_ID} onDelete={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("João")).toBeInTheDocument();
    });
  });

  it("T7: conversationId diferente → fetch com o novo ID", async () => {
    const OTHER_ID = "conv-uuid-99";
    mockApiFetch.mockResolvedValue({
      ...FULL_RESPONSE,
      conversation: { ...FULL_RESPONSE.conversation, id: OTHER_ID },
    });

    render(<ChatPanel conversationId={OTHER_ID} onDelete={vi.fn()} />);

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(`/conversations/${OTHER_ID}/full`);
    });
  });
});
