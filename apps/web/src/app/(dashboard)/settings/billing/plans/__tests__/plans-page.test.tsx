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
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/settings/billing/plans",
}));

import PlansPage from "../page";

// ── fixtures ──────────────────────────────────────────────────────────────────

const mockOrg = { id: "org-uuid-123", name: "Minha Empresa" };

const mockPlans = [
  {
    id: "plan-free",
    name: "Free",
    slug: "free",
    price_monthly: 0,
    price_yearly: 0,
    currency: "BRL",
    max_agents: 1,
    max_instances: 1,
    max_members: 3,
    features: ["basic_support"],
    is_active: true,
    sort_order: 0,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  },
  {
    id: "plan-pro",
    name: "Pro",
    slug: "pro",
    price_monthly: 19700,
    price_yearly: 197000,
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
  {
    id: "plan-enterprise",
    name: "Enterprise",
    slug: "enterprise",
    price_monthly: 49700,
    price_yearly: 497000,
    currency: "BRL",
    max_agents: 20,
    max_instances: 10,
    max_members: 50,
    features: ["multi_agent", "webhooks", "sso", "priority_support"],
    is_active: true,
    sort_order: 2,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  },
];

const mockBillingDataNoSub = {
  subscription: null,
  plan: null,
  usage: { agents_used: 0, members_used: 0, instances_used: 0 },
  limits: null,
  recentEvents: [],
};

const mockBillingDataWithSub = {
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
    price_monthly: 19700,
    price_yearly: 197000,
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
  recentEvents: [],
};

// ── tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PlansPage", () => {
  it("cenário 1: loading state — orgLoading: true → renderiza skeletons, não chama apiFetch", () => {
    mockUseOrganization.mockReturnValue({ currentOrg: null, loading: true });

    render(<PlansPage />);

    const pulseElements = document.querySelectorAll(".animate-pulse");
    expect(pulseElements.length).toBeGreaterThan(0);
    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it("cenário 2: lista de planos sem assinatura — renderiza nomes, preços e botões 'Assinar' ativos", async () => {
    mockUseOrganization.mockReturnValue({ currentOrg: mockOrg, loading: false });
    mockApiFetch.mockImplementation((url: string) => {
      if (url === "/billing/plans") return Promise.resolve(mockPlans);
      if (url.includes("subscription")) return Promise.resolve(mockBillingDataNoSub);
      return Promise.reject(new Error("URL inesperada: " + url));
    });

    render(<PlansPage />);

    // All plan names render
    await waitFor(() => {
      expect(screen.getByText("Free")).toBeInTheDocument();
    });
    expect(screen.getByText("Pro")).toBeInTheDocument();
    expect(screen.getByText("Enterprise")).toBeInTheDocument();

    // Free plan shows "Gratuito"
    expect(screen.getByText("Gratuito")).toBeInTheDocument();

    // Upgrade buttons rendered and not disabled
    const upgradeButtons = screen.getAllByRole("button");
    const activeButtons = upgradeButtons.filter((btn) => !btn.hasAttribute("disabled"));
    expect(activeButtons.length).toBe(3);

    // apiFetch called correctly
    expect(mockApiFetch).toHaveBeenCalledWith("/billing/plans");
    expect(mockApiFetch).toHaveBeenCalledWith("/billing/subscription", {
      headers: { "x-organization-id": "org-uuid-123" },
    });
  });

  it("cenário 3: badge de plano atual — slug 'pro' bate com plan.slug da subscription → badge e CTA desabilitado", async () => {
    mockUseOrganization.mockReturnValue({ currentOrg: mockOrg, loading: false });
    mockApiFetch.mockImplementation((url: string) => {
      if (url === "/billing/plans") return Promise.resolve(mockPlans);
      if (url.includes("subscription")) return Promise.resolve(mockBillingDataWithSub);
      return Promise.reject(new Error("URL inesperada: " + url));
    });

    render(<PlansPage />);

    await waitFor(() => {
      expect(screen.getByText("Pro")).toBeInTheDocument();
    });

    // Badge "Plano atual" visible
    const badges = screen.getAllByText("Plano atual");
    expect(badges.length).toBeGreaterThanOrEqual(1);

    // The "Pro" card CTA button should be disabled
    const buttons = screen.getAllByRole("button");
    const disabledButton = buttons.find(
      (btn) => btn.hasAttribute("disabled") && btn.textContent === "Plano atual"
    );
    expect(disabledButton).toBeDefined();

    // Other plan buttons should be active (upgrade)
    const activeButtons = buttons.filter((btn) => !btn.hasAttribute("disabled"));
    expect(activeButtons.length).toBe(2); // Free and Enterprise
  });
});
