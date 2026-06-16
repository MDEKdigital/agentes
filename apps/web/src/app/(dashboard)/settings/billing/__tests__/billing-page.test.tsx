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

// Mock next/navigation (needed by organization-provider transitively if imported)
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/settings/billing",
}));

import BillingPage from "../page";

// ── helpers ───────────────────────────────────────────────────────────────────

const mockOrg = { id: "org-uuid-123", name: "Minha Empresa" };

const emptyBillingData = {
  subscription: null,
  plan: null,
  usage: { agents_used: 0, members_used: 0, instances_used: 0 },
  limits: null,
  recentEvents: [],
};

const fullBillingData = {
  subscription: {
    id: "sub-1",
    organization_id: "org-uuid-123",
    plan_id: "plan-pro",
    status: "active",
    billing_interval: "monthly",
    gateway: "stripe",
    gateway_subscription_id: "stripe-sub-xyz",
    gateway_customer_id: "stripe-cus-abc",
    current_period_start: "2026-06-01T00:00:00Z",
    current_period_end: "2026-07-01T00:00:00Z",
    trial_end: null,
    cancelled_at: null,
    cancel_at_period_end: false,
    metadata: {},
    created_at: "2026-06-01T00:00:00Z",
    updated_at: "2026-06-01T00:00:00Z",
  },
  plan: {
    id: "plan-pro",
    name: "Pro",
    slug: "pro",
    price_monthly: 19900,
    price_yearly: 199000,
    currency: "BRL",
    max_agents: 5,
    max_instances: 3,
    max_members: 10,
    features: ["multi_agent", "webhooks"],
    is_active: true,
    sort_order: 1,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  },
  usage: { agents_used: 2, members_used: 3, instances_used: 1 },
  limits: { max_agents: 5, max_members: 10, max_instances: 3 },
  recentEvents: [
    {
      id: "evt-1",
      idempotency_key: "key-1",
      gateway: "stripe",
      gateway_event_id: "evt_stripe_1",
      event_type: "subscription.activated",
      raw_payload: {},
      normalized_payload: {},
      status: "processed",
      organization_id: "org-uuid-123",
      subscription_id: "sub-1",
      error_message: null,
      processed_at: "2026-06-01T10:00:00Z",
      created_at: "2026-06-01T10:00:00Z",
      updated_at: "2026-06-01T10:00:00Z",
    },
    {
      id: "evt-2",
      idempotency_key: "key-2",
      gateway: "stripe",
      gateway_event_id: "evt_stripe_2",
      event_type: "subscription.renewed",
      raw_payload: {},
      normalized_payload: {},
      status: "failed",
      organization_id: "org-uuid-123",
      subscription_id: "sub-1",
      error_message: "Payment declined",
      processed_at: null,
      created_at: "2026-06-02T10:00:00Z",
      updated_at: "2026-06-02T10:00:00Z",
    },
  ],
};

// ── tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

describe("BillingPage", () => {
  it("cenário 1: loading state — orgLoading: true → renderiza skeletons, não chama apiFetch", () => {
    mockUseOrganization.mockReturnValue({
      currentOrg: null,
      loading: true,
    });

    render(<BillingPage />);

    // Should show animated pulse elements (skeletons)
    const pulseElements = document.querySelectorAll(".animate-pulse");
    expect(pulseElements.length).toBeGreaterThan(0);

    // apiFetch should not have been called
    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it("cenário 2: empty state — apiFetch retorna dados sem assinatura → renderiza 'Nenhuma assinatura encontrada'", async () => {
    mockUseOrganization.mockReturnValue({
      currentOrg: mockOrg,
      loading: false,
    });
    mockApiFetch.mockResolvedValue(emptyBillingData);

    render(<BillingPage />);

    await waitFor(() => {
      expect(screen.getByText("Nenhuma assinatura encontrada.")).toBeInTheDocument();
    });

    // Events section should show empty state
    expect(screen.getByText("Nenhum evento de billing registrado.")).toBeInTheDocument();

    // apiFetch should have been called with correct args
    expect(mockApiFetch).toHaveBeenCalledWith("/billing/subscription", {
      headers: { "x-organization-id": "org-uuid-123" },
    });
  });

  it("cenário 3: com dados completos → renderiza nome do plano, status, usages e histórico", async () => {
    mockUseOrganization.mockReturnValue({
      currentOrg: mockOrg,
      loading: false,
    });
    mockApiFetch.mockResolvedValue(fullBillingData);

    render(<BillingPage />);

    // Plan name
    await waitFor(() => {
      expect(screen.getByText("Pro")).toBeInTheDocument();
    });

    // Status badge
    expect(screen.getByText("Ativa")).toBeInTheDocument();

    // Usage bars text
    expect(screen.getByText("2 / 5 agentes")).toBeInTheDocument();
    expect(screen.getByText("3 / 10 membros")).toBeInTheDocument();
    expect(screen.getByText("1 / 3 instâncias whatsapp")).toBeInTheDocument();

    // Billing events
    expect(screen.getByText("Histórico de billing")).toBeInTheDocument();
    expect(screen.getByText("subscription.activated")).toBeInTheDocument();
    expect(screen.getByText("subscription.renewed")).toBeInTheDocument();

    // Event status badges
    expect(screen.getByText("Processado")).toBeInTheDocument();
    expect(screen.getByText("Falhou")).toBeInTheDocument();

    // Organization ID
    expect(screen.getByText("org-uuid-123")).toBeInTheDocument();
  });
});
