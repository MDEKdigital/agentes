import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import React from "react";

// ── hoisted mocks ─────────────────────────────────────────────────────────────
const { mockUseOrganization, mockApiFetch, mockRouterPush, mockCreateClient } = vi.hoisted(() => ({
  mockUseOrganization: vi.fn(),
  mockApiFetch: vi.fn(),
  mockRouterPush: vi.fn(),
  mockCreateClient: vi.fn(),
}));

vi.mock("@/providers/organization-provider", () => ({
  useOrganization: mockUseOrganization,
}));

vi.mock("@/lib/api", () => ({
  apiFetch: mockApiFetch,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockRouterPush }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: mockCreateClient,
}));

// Mock AgentForm to expose onSubmit as a testable button
vi.mock("@/components/agents/agent-form", () => ({
  AgentForm: ({
    onSubmit,
    submitLabel,
  }: {
    onSubmit: (values: Record<string, unknown>) => Promise<void>;
    submitLabel: string;
  }) =>
    React.createElement(
      "button",
      {
        "data-testid": "mock-submit",
        onClick: () => { void onSubmit({ name: "Agente Teste", provider: "openai", model: "gpt-4.1-mini" }); },
      },
      submitLabel
    ),
}));

import NewAgentPage from "../page";

// ── fixtures ──────────────────────────────────────────────────────────────────
const mockOrg = { id: "org-uuid-1", name: "Empresa Teste" };

// ── setup ─────────────────────────────────────────────────────────────────────
beforeEach(() => {
  vi.clearAllMocks();
  mockUseOrganization.mockReturnValue({ currentOrg: mockOrg });
});

// ── testes ────────────────────────────────────────────────────────────────────
describe("NewAgentPage", () => {
  it("A: sucesso → apiFetch chamado com path correto + redireciona para /agents", async () => {
    mockApiFetch.mockResolvedValue({ id: "agent-1", name: "Agente Teste" });

    render(<NewAgentPage />);
    fireEvent.click(screen.getByTestId("mock-submit"));

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(
        `/organizations/${mockOrg.id}/agents`,
        expect.objectContaining({ method: "POST" })
      );
      expect(mockRouterPush).toHaveBeenCalledWith("/agents");
    });
  });

  it("B: limite atingido → exibe mensagem de erro de limite sem redirecionar", async () => {
    mockApiFetch.mockRejectedValue(new Error("Limite de agentes atingido para este plano"));

    render(<NewAgentPage />);
    fireEvent.click(screen.getByTestId("mock-submit"));

    await waitFor(() => {
      expect(screen.getByText("Limite de agentes atingido para este plano")).toBeInTheDocument();
    });

    expect(mockRouterPush).not.toHaveBeenCalled();
  });

  it("C: erro genérico → exibe mensagem de erro sem redirecionar", async () => {
    mockApiFetch.mockRejectedValue(new Error("Erro interno do servidor"));

    render(<NewAgentPage />);
    fireEvent.click(screen.getByTestId("mock-submit"));

    await waitFor(() => {
      expect(screen.getByText("Erro interno do servidor")).toBeInTheDocument();
    });

    expect(mockRouterPush).not.toHaveBeenCalled();
  });

  it("D: Supabase não é utilizado diretamente pela página", async () => {
    mockApiFetch.mockResolvedValue({ id: "agent-1" });

    render(<NewAgentPage />);
    fireEvent.click(screen.getByTestId("mock-submit"));

    await waitFor(() => {
      expect(mockRouterPush).toHaveBeenCalledWith("/agents");
    });

    expect(mockCreateClient).not.toHaveBeenCalled();
  });
});
