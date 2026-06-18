import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import React from "react";

// ── hoisted mocks ─────────────────────────────────────────────────────────────
const {
  mockUseOrganization,
  mockApiFetch,
  mockRouterPush,
  mockCreateClient,
  mockUseRealtime,
  mockSearchParams,
} = vi.hoisted(() => ({
  mockUseOrganization: vi.fn(),
  mockApiFetch: vi.fn(),
  mockRouterPush: vi.fn(),
  mockCreateClient: vi.fn(),
  mockUseRealtime: vi.fn(),
  mockSearchParams: vi.fn(),
}));

vi.mock("@/providers/organization-provider", () => ({
  useOrganization: mockUseOrganization,
}));

vi.mock("@/lib/api", () => ({
  apiFetch: mockApiFetch,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockRouterPush }),
  useSearchParams: mockSearchParams,
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: mockCreateClient,
}));

vi.mock("@/lib/realtime", () => ({
  useRealtime: mockUseRealtime,
}));

vi.mock("@/components/inbox/conversation-list", () => ({
  ConversationList: ({ conversations }: { conversations: unknown[] }) =>
    React.createElement(
      "div",
      { "data-testid": "conversation-list" },
      `count:${conversations.length}`
    ),
}));

vi.mock("@/components/inbox/chat-panel", () => ({
  ChatPanel: () => React.createElement("div", { "data-testid": "chat-panel" }),
}));

import InboxPage from "../page";

// ── fixtures ──────────────────────────────────────────────────────────────────
const ORG_ID = "org-uuid-1";
const mockOrg = { id: ORG_ID, name: "Empresa Teste" };

const CONV_FIXTURE = [
  {
    id: "conv-1",
    organization_id: ORG_ID,
    status: "open",
    is_human_takeover: false,
    last_message_at: "2026-01-01T00:00:00Z",
    tags: [],
    assigned_to: null,
    contacts: { phone: "+5511999999999", name: "João" },
    agents: { name: "Bot" },
  },
];

// ── setup ─────────────────────────────────────────────────────────────────────
beforeEach(() => {
  vi.clearAllMocks();
  mockUseOrganization.mockReturnValue({ currentOrg: mockOrg });
  mockSearchParams.mockReturnValue({ get: () => null });
  mockUseRealtime.mockReturnValue(undefined);
  mockApiFetch.mockResolvedValue(CONV_FIXTURE);
});

// ── testes ────────────────────────────────────────────────────────────────────
describe("InboxPage", () => {
  it("A: busca conversas via apiFetch com organizationId no path", async () => {
    render(<InboxPage />);

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(
        `/organizations/${ORG_ID}/conversations`
      );
    });
  });

  it("B: createClient não é chamado para buscar conversas", async () => {
    render(<InboxPage />);

    await waitFor(() => {
      expect(screen.getByTestId("conversation-list")).toBeInTheDocument();
    });

    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it("C: conversas buscadas são exibidas na lista", async () => {
    render(<InboxPage />);

    await waitFor(() => {
      expect(screen.getByTestId("conversation-list")).toHaveTextContent("count:1");
    });
  });

  it("D: filtro de status appenda ?status= na URL da API", async () => {
    render(<InboxPage />);

    // Aguarda o render inicial
    await waitFor(() => {
      expect(screen.getByTestId("conversation-list")).toBeInTheDocument();
    });

    // Clica na aba "Abertas"
    const abrirtasTab = screen.getByText("Abertas");
    fireEvent.click(abrirtasTab);

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(
        `/organizations/${ORG_ID}/conversations?status=open`
      );
    });
  });

  it("E: não faz fetch enquanto currentOrg não estiver disponível", () => {
    mockUseOrganization.mockReturnValue({ currentOrg: null });

    render(<InboxPage />);

    expect(mockApiFetch).not.toHaveBeenCalled();
  });
});
