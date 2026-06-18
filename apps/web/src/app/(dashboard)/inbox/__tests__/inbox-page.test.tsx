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

const CONV_1 = {
  id: "conv-1",
  organization_id: ORG_ID,
  status: "open",
  is_human_takeover: false,
  last_message_at: "2026-01-01T00:00:00Z",
  tags: [],
  assigned_to: null,
  contacts: { phone: "+5511999999999", name: "João" },
  agents: { name: "Bot" },
};

const CONV_2 = { ...CONV_1, id: "conv-2", contacts: { phone: "+5511888888888", name: "Maria" } };

const PAGE_1_RESPONSE = {
  conversations: [CONV_1],
  total: 2,
  page: 1,
  limit: 50,
  hasMore: true,
};

const PAGE_2_RESPONSE = {
  conversations: [CONV_2],
  total: 2,
  page: 2,
  limit: 50,
  hasMore: false,
};

const SINGLE_PAGE_RESPONSE = {
  conversations: [CONV_1],
  total: 1,
  page: 1,
  limit: 50,
  hasMore: false,
};

// ── setup ─────────────────────────────────────────────────────────────────────
beforeEach(() => {
  vi.clearAllMocks();
  mockUseOrganization.mockReturnValue({ currentOrg: mockOrg });
  mockSearchParams.mockReturnValue({ get: () => null });
  mockUseRealtime.mockReturnValue(undefined);
  mockApiFetch.mockResolvedValue(SINGLE_PAGE_RESPONSE);
});

// ── testes ────────────────────────────────────────────────────────────────────
describe("InboxPage — paginação", () => {
  it("A: busca conversas com page=1&limit=50 no path", async () => {
    render(<InboxPage />);

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(
        `/organizations/${ORG_ID}/conversations?page=1&limit=50`
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

  it("C: conversas retornadas são exibidas na lista", async () => {
    render(<InboxPage />);

    await waitFor(() => {
      expect(screen.getByTestId("conversation-list")).toHaveTextContent("count:1");
    });
  });

  it("D: filtro de status appenda ?status= após page e limit", async () => {
    render(<InboxPage />);

    await waitFor(() => {
      expect(screen.getByTestId("conversation-list")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Abertas"));

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(
        `/organizations/${ORG_ID}/conversations?page=1&limit=50&status=open`
      );
    });
  });

  it("E: não faz fetch enquanto currentOrg não estiver disponível", () => {
    mockUseOrganization.mockReturnValue({ currentOrg: null });

    render(<InboxPage />);

    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it("F: hasMore=true → exibe botão Carregar mais", async () => {
    mockApiFetch.mockResolvedValue(PAGE_1_RESPONSE);

    render(<InboxPage />);

    await waitFor(() => {
      expect(screen.getByTestId("load-more-button")).toBeInTheDocument();
    });
  });

  it("G: hasMore=false → não exibe botão Carregar mais", async () => {
    render(<InboxPage />);

    await waitFor(() => {
      expect(screen.getByTestId("conversation-list")).toBeInTheDocument();
    });

    expect(screen.queryByTestId("load-more-button")).not.toBeInTheDocument();
  });

  it("H: clicar Carregar mais → apiFetch com page=2&limit=50", async () => {
    mockApiFetch
      .mockResolvedValueOnce(PAGE_1_RESPONSE)
      .mockResolvedValueOnce(PAGE_2_RESPONSE);

    render(<InboxPage />);

    await waitFor(() => {
      expect(screen.getByTestId("load-more-button")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("load-more-button"));

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(
        `/organizations/${ORG_ID}/conversations?page=2&limit=50`
      );
    });
  });

  it("I: após Carregar mais → lista acumula conversas das duas páginas", async () => {
    mockApiFetch
      .mockResolvedValueOnce(PAGE_1_RESPONSE)
      .mockResolvedValueOnce(PAGE_2_RESPONSE);

    render(<InboxPage />);

    await waitFor(() => {
      expect(screen.getByTestId("load-more-button")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("load-more-button"));

    await waitFor(() => {
      expect(screen.getByTestId("conversation-list")).toHaveTextContent("count:2");
    });
  });

  it("J: mudar filtro de status → reseta para página 1 e substitui lista", async () => {
    mockApiFetch
      .mockResolvedValueOnce(PAGE_1_RESPONSE)
      .mockResolvedValueOnce(PAGE_2_RESPONSE)
      .mockResolvedValueOnce(SINGLE_PAGE_RESPONSE);

    render(<InboxPage />);

    await waitFor(() => {
      expect(screen.getByTestId("load-more-button")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("load-more-button"));

    await waitFor(() => {
      expect(screen.getByTestId("conversation-list")).toHaveTextContent("count:2");
    });

    fireEvent.click(screen.getByText("Abertas"));

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(
        `/organizations/${ORG_ID}/conversations?page=1&limit=50&status=open`
      );
      expect(screen.getByTestId("conversation-list")).toHaveTextContent("count:1");
    });
  });
});
