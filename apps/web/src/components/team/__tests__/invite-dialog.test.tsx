import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
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

// Mock Dialog to avoid Radix UI portal/pointer issues in jsdom.
// Content is always rendered; open/close tested via state-driven behavior.
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", { "data-testid": "dialog-root" }, children),
  DialogTrigger: ({ children }: { children: React.ReactNode; asChild?: boolean }) =>
    React.createElement("div", { "data-testid": "dialog-trigger" }, children),
  DialogContent: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", { "data-testid": "dialog-content" }, children),
  DialogHeader: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", null, children),
  DialogTitle: ({ children }: { children: React.ReactNode }) =>
    React.createElement("h2", null, children),
}));

// Mock Select to avoid Radix UI issues in jsdom
vi.mock("@/components/ui/select", () => ({
  Select: ({ children, value }: { children: React.ReactNode; value?: string; onValueChange?: (v: string) => void }) =>
    React.createElement("div", { "data-testid": "select", "data-value": value }, children),
  SelectTrigger: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", null, children),
  SelectContent: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", null, children),
  SelectItem: ({ children, value }: { children: React.ReactNode; value: string }) =>
    React.createElement("div", { "data-value": value }, children),
  SelectValue: () => null,
}));

import { InviteDialog } from "../invite-dialog";

// ── fixtures ──────────────────────────────────────────────────────────────────
const mockOrg = { id: "org-uuid-1", name: "Empresa Teste" };

// ── helpers ───────────────────────────────────────────────────────────────────
function fillEmail(email: string) {
  const input = screen.getByPlaceholderText("email@exemplo.com");
  fireEvent.change(input, { target: { value: email } });
}

function clickSubmit() {
  fireEvent.click(screen.getByRole("button", { name: /enviar convite/i }));
}

// ── setup ─────────────────────────────────────────────────────────────────────
beforeEach(() => {
  vi.clearAllMocks();
  mockUseOrganization.mockReturnValue({ currentOrg: mockOrg });
});

// ── testes ────────────────────────────────────────────────────────────────────
describe("InviteDialog", () => {
  it("A: sucesso → apiFetch chamado corretamente e onInvited() disparado", async () => {
    mockApiFetch.mockResolvedValue({ id: "inv-1" });
    const onInvited = vi.fn();

    render(<InviteDialog onInvited={onInvited} />);

    fillEmail("test@example.com");
    clickSubmit();

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(
        `/organizations/${mockOrg.id}/invitations`,
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"email":"test@example.com"'),
        })
      );
      expect(onInvited).toHaveBeenCalled();
    });
  });

  it("B: limite atingido → exibe mensagem de erro sem chamar onInvited", async () => {
    mockApiFetch.mockRejectedValue(new Error("Limite de membros atingido para este plano"));
    const onInvited = vi.fn();

    render(<InviteDialog onInvited={onInvited} />);

    fillEmail("test@example.com");
    clickSubmit();

    await waitFor(() => {
      expect(screen.getByText("Limite de membros atingido para este plano")).toBeInTheDocument();
    });

    expect(onInvited).not.toHaveBeenCalled();
  });

  it("C: email vazio → botão desabilitado e apiFetch não é chamado", () => {
    const onInvited = vi.fn();

    render(<InviteDialog onInvited={onInvited} />);

    const submitButton = screen.getByRole("button", { name: /enviar convite/i });
    expect(submitButton).toBeDisabled();

    expect(mockApiFetch).not.toHaveBeenCalled();
    expect(onInvited).not.toHaveBeenCalled();
  });

  it("D: Supabase não é utilizado diretamente", async () => {
    mockApiFetch.mockResolvedValue({ id: "inv-1" });
    const onInvited = vi.fn();

    render(<InviteDialog onInvited={onInvited} />);

    fillEmail("test@example.com");
    clickSubmit();

    await waitFor(() => {
      expect(onInvited).toHaveBeenCalled();
    });

    expect(mockCreateClient).not.toHaveBeenCalled();
  });
});
