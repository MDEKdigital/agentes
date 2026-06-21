import { describe, it, expect, vi, beforeEach } from "vitest";

// ── hoisted mocks ─────────────────────────────────────────────────────────────
const {
  mockGetPlanByGatewayProduct,
  mockCreateSubscription,
  mockFindPendingInvitationByEmail,
  mockFindSubscriptionByGatewayId,
  mockCreateOrganizationForBilling,
  mockIsSlugAvailable,
  mockUpdateBillingEventStatus,
  mockCreateInvitation,
  mockSendWelcomeEmail,
  mockCreateAuditLog,
} = vi.hoisted(() => ({
  mockGetPlanByGatewayProduct: vi.fn(),
  mockCreateSubscription: vi.fn(),
  mockFindPendingInvitationByEmail: vi.fn(),
  mockFindSubscriptionByGatewayId: vi.fn(),
  mockCreateOrganizationForBilling: vi.fn(),
  mockIsSlugAvailable: vi.fn(),
  mockUpdateBillingEventStatus: vi.fn(),
  mockCreateInvitation: vi.fn(),
  mockSendWelcomeEmail: vi.fn(),
  mockCreateAuditLog: vi.fn(),
}));

vi.mock("@aula-agente/database", () => ({
  getAdminClient: vi.fn(() => ({})),
  getPlanByGatewayProduct: mockGetPlanByGatewayProduct,
  getPlanBySlug: vi.fn(),
  createSubscription: mockCreateSubscription,
  updateSubscriptionStatus: vi.fn(),
  findPendingInvitationByEmail: mockFindPendingInvitationByEmail,
  createOrganizationForBilling: mockCreateOrganizationForBilling,
  findSubscriptionByGatewayId: mockFindSubscriptionByGatewayId,
  updateOrganizationOnboardingStatus: vi.fn(),
  isSlugAvailable: mockIsSlugAvailable,
  updateBillingEventStatus: mockUpdateBillingEventStatus,
  createInvitation: mockCreateInvitation,
  createAuditLog: mockCreateAuditLog,
}));

vi.mock("../email-service", () => ({
  sendWelcomeEmail: mockSendWelcomeEmail,
}));

import { handleSubscriptionActivated } from "../onboarding-service";
import type { NormalizedBillingEvent } from "../../normalizers/index";

const CLIENT = {} as any;

function makeNormalized(overrides: Partial<NormalizedBillingEvent> = {}): NormalizedBillingEvent {
  return {
    event_type: "subscription.activated",
    gateway: "hotmart",
    gateway_event_id: "evt-1",
    customer: { email: "user@test.com", name: "João Silva" },
    product: { gateway_product_id: "prod-1", name: "Plano Pro" },
    subscription: {
      gateway_subscription_id: "sub-abc",
      interval: "monthly",
    },
    currency: "BRL",
    metadata: {},
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetPlanByGatewayProduct.mockResolvedValue({ plans: { id: "plan-uuid", name: "Plano Pro" } });
  mockFindPendingInvitationByEmail.mockResolvedValue(null);
  mockFindSubscriptionByGatewayId.mockResolvedValue(null);
  mockIsSlugAvailable.mockResolvedValue(true);
  mockCreateOrganizationForBilling.mockResolvedValue({ id: "org-uuid" });
  mockCreateInvitation.mockResolvedValue({ id: "inv-uuid" });
  mockCreateSubscription.mockResolvedValue({ id: "sub-uuid", organization_id: "org-uuid" });
  mockUpdateBillingEventStatus.mockResolvedValue(undefined);
  mockSendWelcomeEmail.mockResolvedValue(undefined);
  mockCreateAuditLog.mockResolvedValue({ id: "audit-uuid" });
});

// ─── C11 — Duplicate subscription on billing event retry ─────────────────────

describe("C11: duplicate subscription on billing event retry", () => {
  it("C11: retry com gateway_subscription_id existente NÃO chama createSubscription novamente", async () => {
    // Simulates: first call already created org + invitation + subscription
    // On retry, invitation exists (triggering dedup), and subscription also exists
    mockFindPendingInvitationByEmail.mockResolvedValue({
      id: "inv-1",
      organization_id: "org-1",
    });
    mockFindSubscriptionByGatewayId.mockResolvedValue({
      id: "sub-existing",
      organization_id: "org-1",
    });

    await handleSubscriptionActivated(CLIENT, "be-retry", makeNormalized());

    expect(mockCreateSubscription).not.toHaveBeenCalled();
  });

  it("C11: retry reutiliza subscription existente e marca billing_event como processed", async () => {
    mockFindPendingInvitationByEmail.mockResolvedValue({
      id: "inv-1",
      organization_id: "org-1",
    });
    mockFindSubscriptionByGatewayId.mockResolvedValue({
      id: "sub-existing",
      organization_id: "org-1",
    });

    await handleSubscriptionActivated(CLIENT, "be-retry-2", makeNormalized());

    expect(mockUpdateBillingEventStatus).toHaveBeenCalledWith(
      CLIENT,
      "be-retry-2",
      "processed",
      expect.objectContaining({ subscription_id: "sub-existing" })
    );
  });

  it("C11: audit plan.activated dispara com id da subscription existente no retry", async () => {
    mockFindPendingInvitationByEmail.mockResolvedValue({
      id: "inv-1",
      organization_id: "org-1",
    });
    mockFindSubscriptionByGatewayId.mockResolvedValue({
      id: "sub-existing",
      organization_id: "org-1",
    });

    await handleSubscriptionActivated(CLIENT, "be-retry-3", makeNormalized());

    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      CLIENT,
      expect.objectContaining({
        action: "plan.activated",
        entity_id: "sub-existing",
      })
    );
  });

  it("C11: caminho nominal (sem sub existente) → cria subscription normalmente", async () => {
    // No existing invitation, no existing subscription → normal path
    mockFindSubscriptionByGatewayId.mockResolvedValue(null);

    await handleSubscriptionActivated(CLIENT, "be-nominal", makeNormalized());

    expect(mockCreateSubscription).toHaveBeenCalledOnce();
    expect(mockUpdateBillingEventStatus).toHaveBeenCalledWith(
      CLIENT,
      "be-nominal",
      "processed",
      expect.objectContaining({ subscription_id: "sub-uuid" })
    );
  });

  it("C11: sem gateway_subscription_id → cria subscription (sem checagem de duplicata)", async () => {
    const normalized = makeNormalized({ subscription: undefined });

    await handleSubscriptionActivated(CLIENT, "be-no-sub-id", normalized);

    expect(mockCreateSubscription).toHaveBeenCalledOnce();
  });
});

// ─── C13 — Slug TOCTOU on concurrent onboarding ──────────────────────────────

describe("C13: slug TOCTOU on concurrent onboarding", () => {
  it("C13: unique violation (23505) no slug não propaga como erro definitivo", async () => {
    const slugError = Object.assign(new Error("duplicate key value violates unique constraint"), {
      code: "23505",
    });
    mockCreateOrganizationForBilling
      .mockRejectedValueOnce(slugError)
      .mockResolvedValueOnce({ id: "org-retry" });

    await expect(
      handleSubscriptionActivated(CLIENT, "be-c13", makeNormalized())
    ).resolves.not.toThrow();
  });

  it("C13: após slug unique violation, tenta criar org com slug diferente", async () => {
    const slugError = Object.assign(new Error("duplicate key value"), { code: "23505" });
    mockCreateOrganizationForBilling
      .mockRejectedValueOnce(slugError)
      .mockResolvedValueOnce({ id: "org-retry" });

    await handleSubscriptionActivated(CLIENT, "be-c13b", makeNormalized());

    expect(mockCreateOrganizationForBilling).toHaveBeenCalledTimes(2);
    const firstSlug = mockCreateOrganizationForBilling.mock.calls[0][1].slug;
    const secondSlug = mockCreateOrganizationForBilling.mock.calls[1][1].slug;
    expect(secondSlug).not.toBe(firstSlug);
  });

  it("C13: org é criada com slug válido alternativo após corrida", async () => {
    const slugError = Object.assign(new Error("duplicate key value"), { code: "23505" });
    mockCreateOrganizationForBilling
      .mockRejectedValueOnce(slugError)
      .mockResolvedValueOnce({ id: "org-after-race" });
    mockCreateInvitation.mockResolvedValue({ id: "inv-after-race" });

    await handleSubscriptionActivated(CLIENT, "be-c13c", makeNormalized());

    // org was ultimately created with SOME slug
    expect(mockCreateOrganizationForBilling).toHaveBeenCalledTimes(2);
    const secondCall = mockCreateOrganizationForBilling.mock.calls[1];
    expect(typeof secondCall[1].slug).toBe("string");
    expect(secondCall[1].slug.length).toBeGreaterThan(0);
  });

  it("C13: billing event é marcado como processed (não failed) após slug race", async () => {
    const slugError = Object.assign(new Error("duplicate key value"), { code: "23505" });
    mockCreateOrganizationForBilling
      .mockRejectedValueOnce(slugError)
      .mockResolvedValueOnce({ id: "org-ok" });

    await handleSubscriptionActivated(CLIENT, "be-c13d", makeNormalized());

    expect(mockUpdateBillingEventStatus).toHaveBeenCalledWith(
      CLIENT,
      "be-c13d",
      "processed",
      expect.any(Object)
    );
    const failedCalls = mockUpdateBillingEventStatus.mock.calls.filter(
      (args) => args[2] === "failed"
    );
    expect(failedCalls).toHaveLength(0);
  });

  it("C13: erros não-slug (código diferente de 23505) continuam propagando", async () => {
    const dbError = Object.assign(new Error("connection timeout"), { code: "08006" });
    mockCreateOrganizationForBilling.mockRejectedValue(dbError);

    await expect(
      handleSubscriptionActivated(CLIENT, "be-c13e", makeNormalized())
    ).rejects.toThrow("connection timeout");
  });
});
