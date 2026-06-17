import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import React from "react";

// ── hoisted mocks ─────────────────────────────────────────────────────────────
const { mockUseOrganization, mockApiFetch } = vi.hoisted(() => ({
  mockUseOrganization: vi.fn(),
  mockApiFetch: vi.fn(),
}));

vi.mock("@/providers/organization-provider", () => ({
  useOrganization: mockUseOrganization,
}));

vi.mock("@/lib/api", () => ({
  apiFetch: mockApiFetch,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/settings",
}));

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) =>
    React.createElement("a", { href, className }, children),
}));

import SettingsPage from "../page";

// ── fixtures ─────────────────────────────────────────────────────────────────

const baseOrg = {
  id: "org-uuid-1",
  name: "Empresa Teste",
  slug: "empresa-teste",
  plan: "free" as const,
  plan_id: null as string | null,
  onboarding_status: "active" as const,
  settings: {},
  created_at: "2026-06-01T00:00:00Z",
  updated_at: "2026-06-01T00:00:00Z",
};

// ── setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  global.alert = vi.fn() as unknown as typeof alert;
  global.confirm = vi.fn(() => false) as unknown as typeof confirm;

  mockUseOrganization.mockReturnValue({
    currentOrg: baseOrg,
    loading: false,
    refetch: vi.fn(),
  });

  // fetchApiKeys call — retorna vazio por padrão
  mockApiFetch.mockResolvedValue([]);
});

// ── testes ────────────────────────────────────────────────────────────────────

describe("SettingsPage — exibição do plano", () => {
  it("A: plan_id = null → exibe badge legado 'free'", async () => {
    // baseOrg.plan_id = null, baseOrg.plan = "free"
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("free")).toBeInTheDocument();
    });

    expect(screen.queryByRole("link", { name: /ver plano/i })).not.toBeInTheDocument();
  });

  it("B: plan_id = UUID → exibe link 'Ver plano' para /settings/billing", async () => {
    mockUseOrganization.mockReturnValue({
      currentOrg: { ...baseOrg, plan_id: "plan-uuid-pro" },
      loading: false,
      refetch: vi.fn(),
    });

    render(<SettingsPage />);

    await waitFor(() => {
      const link = screen.getByRole("link", { name: /ver plano/i });
      expect(link).toBeInTheDocument();
      expect(link).toHaveAttribute("href", "/settings/billing");
    });
  });

  it("C: plan_id = UUID → NÃO exibe badge legado 'free'", async () => {
    mockUseOrganization.mockReturnValue({
      currentOrg: { ...baseOrg, plan_id: "plan-uuid-pro" },
      loading: false,
      refetch: vi.fn(),
    });

    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByRole("link", { name: /ver plano/i })).toBeInTheDocument();
    });

    expect(screen.queryByText("free")).not.toBeInTheDocument();
  });
});
