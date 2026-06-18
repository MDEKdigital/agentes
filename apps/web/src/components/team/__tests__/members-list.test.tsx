import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import React from "react";

// ── hoisted mocks ─────────────────────────────────────────────────────────────
const { mockApiFetch, mockCreateClient } = vi.hoisted(() => ({
  mockApiFetch: vi.fn(),
  mockCreateClient: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  apiFetch: mockApiFetch,
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: mockCreateClient,
}));

vi.mock("@/components/ui/avatar", () => ({
  Avatar: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", null, children),
  AvatarFallback: ({ children }: { children: React.ReactNode }) =>
    React.createElement("span", null, children),
}));

// Mock Select como <select> nativo — funciona nativamente no jsdom via fireEvent.change
vi.mock("@/components/ui/select", () => ({
  Select: ({
    children,
    value,
    onValueChange,
  }: {
    children: React.ReactNode;
    value?: string;
    onValueChange?: (v: string) => void;
  }) =>
    React.createElement(
      "select",
      {
        "data-testid": "role-select",
        value,
        onChange: (e: React.ChangeEvent<HTMLSelectElement>) =>
          onValueChange?.(e.target.value),
      },
      children
    ),
  SelectTrigger: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => children,
  SelectItem: ({ children, value }: { children: React.ReactNode; value: string }) =>
    React.createElement("option", { value }, children),
  SelectValue: () => null,
}));

import { MembersList } from "../members-list";

// ── fixtures ──────────────────────────────────────────────────────────────────

const ORG_ID = "org-uuid-1";
const CURRENT_USER_ID = "current-user-uuid";

const agentMember = {
  id: "member-uuid-agent",
  user_id: "other-user-uuid",
  email: "agent@test.com",
  role: "agent",
  created_at: "2026-06-01T00:00:00Z",
};

function renderList(overrides: Partial<React.ComponentProps<typeof MembersList>> = {}) {
  const defaults = {
    members: [agentMember],
    currentUserId: CURRENT_USER_ID,
    currentUserRole: "owner",
    orgId: ORG_ID,
    onRefresh: vi.fn(),
  };
  return render(<MembersList {...defaults} {...overrides} />);
}

// ── setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockApiFetch.mockResolvedValue({});
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).confirm = vi.fn(() => true);
});

// ── testes ────────────────────────────────────────────────────────────────────

describe("MembersList", () => {
  it("A: alteração de role chama apiFetch PATCH com path correto", async () => {
    renderList();

    const select = screen.getByTestId("role-select");
    fireEvent.change(select, { target: { value: "admin" } });

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(
        `/organizations/${ORG_ID}/members/${agentMember.id}`,
        expect.objectContaining({
          method: "PATCH",
          body: expect.stringContaining('"role":"admin"'),
        })
      );
    });
  });

  it("B: remoção de membro chama apiFetch DELETE com path correto", async () => {
    renderList();

    const removeBtn = screen.getByRole("button", { name: /remover/i });
    fireEvent.click(removeBtn);

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(
        `/organizations/${ORG_ID}/members/${agentMember.id}`,
        expect.objectContaining({ method: "DELETE" })
      );
    });
  });

  it("C: Supabase não é utilizado diretamente", async () => {
    renderList();

    const select = screen.getByTestId("role-select");
    fireEvent.change(select, { target: { value: "admin" } });

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalled();
    });

    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it("D: botão remover não exibido para actor com role admin", () => {
    renderList({ currentUserRole: "admin" });

    expect(screen.queryByRole("button", { name: /remover/i })).not.toBeInTheDocument();
  });
});
