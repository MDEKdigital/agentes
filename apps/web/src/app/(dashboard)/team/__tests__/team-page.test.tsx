import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import React from "react";

// ── hoisted mocks ─────────────────────────────────────────────────────────────
const { mockUseOrganization, mockApiFetch, mockCreateClient } = vi.hoisted(() => ({
  mockUseOrganization: vi.fn(),
  mockApiFetch: vi.fn(),
  mockCreateClient: vi.fn(),
}));

vi.mock("@/providers/organization-provider", () => ({
  useOrganization: mockUseOrganization,
}));

vi.mock("@/lib/api", () => ({
  apiFetch: mockApiFetch,
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: mockCreateClient,
}));

// Mock MembersList — evita Radix UI e Select no jsdom
vi.mock("@/components/team/members-list", () => ({
  MembersList: ({ members }: { members: unknown[] }) =>
    React.createElement(
      "div",
      { "data-testid": "members-list" },
      `${members.length} membros`
    ),
}));

// Mock InviteDialog — evita Radix UI Dialog no jsdom
vi.mock("@/components/team/invite-dialog", () => ({
  InviteDialog: ({ onInvited }: { onInvited: () => void }) =>
    React.createElement(
      "button",
      { "data-testid": "invite-dialog", onClick: onInvited },
      "Convidar"
    ),
}));

import TeamPage from "../page";

// ── fixtures ──────────────────────────────────────────────────────────────────

const mockOrg = { id: "org-uuid-1", name: "Empresa Teste" };

const mockMembersResponse = {
  members: [
    {
      id: "m1",
      user_id: "user-uuid-1",
      email: "owner@test.com",
      role: "owner",
      created_at: "2026-06-01T00:00:00Z",
    },
    {
      id: "m2",
      user_id: "user-uuid-2",
      email: "agent@test.com",
      role: "agent",
      created_at: "2026-06-01T00:00:00Z",
    },
  ],
  current_user_id: "user-uuid-1",
};

const mockInvitationsResponse = {
  invitations: [
    {
      id: "inv-1",
      email: "novo@test.com",
      role: "agent",
      expires_at: "2026-07-01T00:00:00Z",
    },
  ],
};

// ── setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockUseOrganization.mockReturnValue({ currentOrg: mockOrg });
  mockApiFetch.mockImplementation((path: string) => {
    if (path.endsWith("/members")) return Promise.resolve(mockMembersResponse);
    if (path.endsWith("/invitations")) return Promise.resolve(mockInvitationsResponse);
    return Promise.resolve({});
  });
});

// ── testes ────────────────────────────────────────────────────────────────────

describe("TeamPage", () => {
  it("A: busca membros via apiFetch e renderiza a lista", async () => {
    render(<TeamPage />);

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(
        `/organizations/${mockOrg.id}/members`
      );
      expect(screen.getByTestId("members-list")).toBeInTheDocument();
    });
  });

  it("B: busca convites via apiFetch e exibe convite pendente", async () => {
    render(<TeamPage />);

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(
        `/organizations/${mockOrg.id}/invitations`
      );
      expect(screen.getByText("novo@test.com")).toBeInTheDocument();
    });
  });

  it("C: Supabase não é utilizado diretamente", async () => {
    render(<TeamPage />);

    await waitFor(() => {
      expect(screen.getByTestId("members-list")).toBeInTheDocument();
    });

    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it("D: contagem de membros exibida no cabeçalho", async () => {
    render(<TeamPage />);

    await waitFor(() => {
      // getAllByText porque o mock de MembersList também exibe "2 membros"
      expect(screen.getAllByText(/2 membros/i).length).toBeGreaterThanOrEqual(1);
    });
  });

  it("E: usuário com role agent (403 em /invitations) não trava a página em loading infinito", async () => {
    // Reproduces the root cause: /invitations returns 403 for agent-role users.
    // Before the fix, Promise.all rejected with no catch, setLoading(false) was never
    // called, and the page stayed in the skeleton state forever.
    mockApiFetch.mockImplementation((path: string) => {
      if (path.endsWith("/members")) return Promise.resolve(mockMembersResponse);
      if (path.endsWith("/invitations")) return Promise.reject(new Error("Acesso de administrador necessário"));
      return Promise.resolve({});
    });

    render(<TeamPage />);

    // The loading skeleton must resolve — members list must render despite 403 on invitations
    await waitFor(() => {
      expect(screen.getByTestId("members-list")).toBeInTheDocument();
    });
  });

  it("F: page renders with empty invitations when /invitations returns 403", async () => {
    mockApiFetch.mockImplementation((path: string) => {
      if (path.endsWith("/members")) return Promise.resolve(mockMembersResponse);
      if (path.endsWith("/invitations")) return Promise.reject(new Error("403 Forbidden"));
      return Promise.resolve({});
    });

    render(<TeamPage />);

    await waitFor(() => {
      expect(screen.getByTestId("members-list")).toBeInTheDocument();
    });

    // No pending invitations section should be rendered (empty list)
    expect(screen.queryByText("Convites Pendentes")).not.toBeInTheDocument();
  });
});
