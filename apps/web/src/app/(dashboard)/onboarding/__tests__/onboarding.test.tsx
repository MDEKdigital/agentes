import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import React from "react";

// ── hoisted mocks ─────────────────────────────────────────────────────────────
const {
  mockUseOrganization,
  mockRouterPush,
  mockRpc,
  mockApiFetch,
} = vi.hoisted(() => ({
  mockUseOrganization: vi.fn(),
  mockRouterPush: vi.fn(),
  mockRpc: vi.fn(),
  mockApiFetch: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockRouterPush }),
}));

vi.mock("@/providers/organization-provider", () => ({
  useOrganization: mockUseOrganization,
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    rpc: mockRpc,
  }),
}));

vi.mock("@/lib/api", () => ({
  apiFetch: mockApiFetch,
}));

import OnboardingPage from "../page";

// ── helpers ───────────────────────────────────────────────────────────────────

function renderPage() {
  return render(<OnboardingPage />);
}

const mockRefetch = vi.fn();

const activeOrg = {
  id: "org-uuid-1",
  name: "Empresa do Cliente",
  slug: "empresa-do-cliente",
  plan: "pro" as const,
  plan_id: "plan-uuid-1",
  onboarding_status: "active" as const,
  settings: { max_documents: 10, max_agents: 5, max_instances: 3 },
  created_at: "2026-06-01T00:00:00Z",
  updated_at: "2026-06-01T00:00:00Z",
};

// ── default state ─────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockRefetch.mockResolvedValue(undefined);
  mockRpc.mockResolvedValue({ data: [{ id: "new-org-id" }], error: null });
  mockApiFetch.mockResolvedValue({ ...activeOrg, name: "Atualizado" });
});

// ── loading state ─────────────────────────────────────────────────────────────

describe("onboarding: estado de carregamento", () => {
  it("loading = true → mostra spinner", () => {
    mockUseOrganization.mockReturnValue({
      loading: true,
      currentOrg: null,
      refetch: mockRefetch,
    });

    renderPage();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});

// ── modo A: sem organização (fluxo manual) ────────────────────────────────────

describe("onboarding: Modo A — sem organização (fluxo manual)", () => {
  beforeEach(() => {
    mockUseOrganization.mockReturnValue({
      loading: false,
      currentOrg: null,
      refetch: mockRefetch,
    });
  });

  it("mostra formulário de criação com botão 'Criar organização'", () => {
    renderPage();
    expect(screen.getByRole("button", { name: /criar organização/i })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/minha empresa/i)).toBeInTheDocument();
  });

  it("submit chama create_organization RPC (NÃO chama apiFetch)", async () => {
    renderPage();

    fireEvent.change(screen.getByPlaceholderText(/minha empresa/i), {
      target: { value: "Minha Empresa" },
    });
    fireEvent.click(screen.getByRole("button", { name: /criar organização/i }));

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith("create_organization", {
        p_name: "Minha Empresa",
        p_slug: "minha-empresa",
      });
    });

    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it("sucesso → chama refetch e redireciona para /inbox", async () => {
    renderPage();

    fireEvent.change(screen.getByPlaceholderText(/minha empresa/i), {
      target: { value: "Minha Empresa" },
    });
    fireEvent.click(screen.getByRole("button", { name: /criar organização/i }));

    await waitFor(() => {
      expect(mockRefetch).toHaveBeenCalled();
      expect(mockRouterPush).toHaveBeenCalledWith("/inbox");
    });
  });

  it("erro do RPC → mostra mensagem de erro", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "slug duplicado" } });
    renderPage();

    fireEvent.change(screen.getByPlaceholderText(/minha empresa/i), {
      target: { value: "Minha Empresa" },
    });
    fireEvent.click(screen.getByRole("button", { name: /criar organização/i }));

    await waitFor(() => {
      expect(screen.getByText(/slug duplicado/i)).toBeInTheDocument();
    });
    expect(mockRouterPush).not.toHaveBeenCalled();
  });
});

// ── modo B: com organização existente (fluxo billing) ─────────────────────────

describe("onboarding: Modo B — organização existente (fluxo billing)", () => {
  beforeEach(() => {
    mockUseOrganization.mockReturnValue({
      loading: false,
      currentOrg: activeOrg,
      refetch: mockRefetch,
    });
  });

  it("mostra formulário de configuração (NÃO mostra 'Criar organização')", () => {
    renderPage();
    expect(screen.queryByRole("button", { name: /criar organização/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /salvar e continuar/i })).toBeInTheDocument();
  });

  it("pré-preenche o nome da organização existente", () => {
    renderPage();
    const input = screen.getByDisplayValue("Empresa do Cliente");
    expect(input).toBeInTheDocument();
  });

  it("submit chama PATCH /organizations/:id/onboarding (NÃO chama create_organization)", async () => {
    renderPage();

    fireEvent.change(screen.getByDisplayValue("Empresa do Cliente"), {
      target: { value: "Novo Nome" },
    });
    fireEvent.click(screen.getByRole("button", { name: /salvar e continuar/i }));

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(
        `/organizations/${activeOrg.id}/onboarding`,
        expect.objectContaining({ method: "PATCH" })
      );
    });

    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("submit não chama create_organization em nenhuma circunstância", async () => {
    renderPage();

    fireEvent.change(screen.getByDisplayValue("Empresa do Cliente"), {
      target: { value: "Novo Nome" },
    });
    fireEvent.click(screen.getByRole("button", { name: /salvar e continuar/i }));

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalled();
    });

    expect(mockRpc).not.toHaveBeenCalledWith("create_organization", expect.anything());
  });

  it("sucesso → chama refetch e redireciona para /inbox", async () => {
    renderPage();

    fireEvent.change(screen.getByDisplayValue("Empresa do Cliente"), {
      target: { value: "Novo Nome" },
    });
    fireEvent.click(screen.getByRole("button", { name: /salvar e continuar/i }));

    await waitFor(() => {
      expect(mockRefetch).toHaveBeenCalled();
      expect(mockRouterPush).toHaveBeenCalledWith("/inbox");
    });
  });

  it("erro do PATCH → mostra mensagem de erro sem redirecionar", async () => {
    mockApiFetch.mockRejectedValue(new Error("Slug já em uso"));
    renderPage();

    fireEvent.change(screen.getByDisplayValue("Empresa do Cliente"), {
      target: { value: "Novo Nome" },
    });
    fireEvent.click(screen.getByRole("button", { name: /salvar e continuar/i }));

    await waitFor(() => {
      expect(screen.getByText(/Slug já em uso/i)).toBeInTheDocument();
    });
    expect(mockRouterPush).not.toHaveBeenCalled();
  });

  it("slug é gerado automaticamente a partir do nome", () => {
    renderPage();

    fireEvent.change(screen.getByDisplayValue("Empresa do Cliente"), {
      target: { value: "Minha Nova Empresa" },
    });

    expect(screen.getByText(/minha-nova-empresa/i)).toBeInTheDocument();
  });

  it("nome que gera slug vazio (ex: '---') desabilita o botão", () => {
    renderPage();

    fireEvent.change(screen.getByDisplayValue("Empresa do Cliente"), {
      target: { value: "---" },
    });

    expect(screen.getByRole("button", { name: /salvar e continuar/i })).toBeDisabled();
  });
});

describe("onboarding: Modo A — nome que gera slug vazio desabilita botão", () => {
  beforeEach(() => {
    mockUseOrganization.mockReturnValue({
      loading: false,
      currentOrg: null,
      refetch: mockRefetch,
    });
  });

  it("nome '---' gera slug vazio e desabilita o botão de criar", () => {
    renderPage();

    fireEvent.change(screen.getByPlaceholderText(/minha empresa/i), {
      target: { value: "---" },
    });

    expect(screen.getByRole("button", { name: /criar organização/i })).toBeDisabled();
  });
});
