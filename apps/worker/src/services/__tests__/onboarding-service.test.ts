import { describe, it, expect, vi, beforeEach } from "vitest";

// ── hoisted mocks ─────────────────────────────────────────────────────────────
const {
  mockGetPlanByGatewayProduct,
  mockGetPlanBySlug,
  mockCreateSubscription,
  mockUpdateSubscriptionStatus,
  mockFindPendingInvitationByEmail,
  mockCreateOrganizationForBilling,
  mockFindSubscriptionByGatewayId,
  mockUpdateOrganizationOnboardingStatus,
  mockIsSlugAvailable,
  mockUpdateBillingEventStatus,
  mockCreateInvitation,
  mockSendWelcomeEmail,
  mockGetAdminClient,
  mockCreateAuditLog,
} = vi.hoisted(() => ({
  mockGetPlanByGatewayProduct: vi.fn(),
  mockGetPlanBySlug: vi.fn(),
  mockCreateSubscription: vi.fn(),
  mockUpdateSubscriptionStatus: vi.fn(),
  mockFindPendingInvitationByEmail: vi.fn(),
  mockCreateOrganizationForBilling: vi.fn(),
  mockFindSubscriptionByGatewayId: vi.fn(),
  mockUpdateOrganizationOnboardingStatus: vi.fn(),
  mockIsSlugAvailable: vi.fn(),
  mockUpdateBillingEventStatus: vi.fn(),
  mockCreateInvitation: vi.fn(),
  mockSendWelcomeEmail: vi.fn(),
  mockGetAdminClient: vi.fn(() => ({})),
  mockCreateAuditLog: vi.fn(),
}));

vi.mock("@aula-agente/database", () => ({
  getAdminClient: mockGetAdminClient,
  getPlanByGatewayProduct: mockGetPlanByGatewayProduct,
  getPlanBySlug: mockGetPlanBySlug,
  createSubscription: mockCreateSubscription,
  updateSubscriptionStatus: mockUpdateSubscriptionStatus,
  findPendingInvitationByEmail: mockFindPendingInvitationByEmail,
  createOrganizationForBilling: mockCreateOrganizationForBilling,
  findSubscriptionByGatewayId: mockFindSubscriptionByGatewayId,
  updateOrganizationOnboardingStatus: mockUpdateOrganizationOnboardingStatus,
  isSlugAvailable: mockIsSlugAvailable,
  updateBillingEventStatus: mockUpdateBillingEventStatus,
  createInvitation: mockCreateInvitation,
  createAuditLog: mockCreateAuditLog,
}));

vi.mock("../email-service", () => ({
  sendWelcomeEmail: mockSendWelcomeEmail,
}));

import {
  handleSubscriptionActivated,
  handleSubscriptionRenewed,
  handleSubscriptionCancelled,
  handleSubscriptionPastDue,
} from "../onboarding-service";
import type { NormalizedBillingEvent } from "../../normalizers/index";

// Functions are fully mocked — cast the client to satisfy TypeScript parameter types
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const CLIENT = {} as any;

function makeNormalized(overrides: Partial<NormalizedBillingEvent> = {}): NormalizedBillingEvent {
  return {
    event_type: "subscription.activated",
    gateway: "hotmart",
    gateway_event_id: "evt-1",
    customer: { email: "user@test.com", name: "João Silva" },
    product: {
      gateway_product_id: "prod-1",
      name: "Plano Pro",
    },
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
  // Defaults for happy path
  mockGetPlanByGatewayProduct.mockResolvedValue({ plans: { id: "plan-uuid", name: "Plano Pro" } });
  mockFindPendingInvitationByEmail.mockResolvedValue(null);
  mockIsSlugAvailable.mockResolvedValue(true);
  mockCreateOrganizationForBilling.mockResolvedValue({ id: "org-uuid" });
  mockCreateInvitation.mockResolvedValue({ id: "inv-uuid" });
  mockCreateSubscription.mockResolvedValue({ id: "sub-uuid", organization_id: "org-uuid" });
  mockUpdateBillingEventStatus.mockResolvedValue(undefined);
  mockSendWelcomeEmail.mockResolvedValue(undefined);
  mockCreateAuditLog.mockResolvedValue({ id: "audit-uuid" });
});

// ─── handleSubscriptionActivated ─────────────────────────────────────────────

describe("handleSubscriptionActivated", () => {
  it("lança erro quando customer.email está vazio", async () => {
    const normalized = makeNormalized({ customer: { email: "", name: "" } });
    await expect(handleSubscriptionActivated(CLIENT, "be-1", normalized)).rejects.toThrow(
      /customer email is missing/
    );
  });

  it("resolve plano via getPlanByGatewayProduct no caminho feliz", async () => {
    await handleSubscriptionActivated(CLIENT, "be-1", makeNormalized());
    expect(mockGetPlanByGatewayProduct).toHaveBeenCalledWith(CLIENT, "hotmart", "prod-1");
    expect(mockGetPlanBySlug).not.toHaveBeenCalled();
  });

  it("fallback para getPlanBySlug quando getPlanByGatewayProduct falha", async () => {
    mockGetPlanByGatewayProduct.mockRejectedValue(new Error("no mapping"));
    mockGetPlanBySlug.mockResolvedValue({ id: "plan-uuid-2", name: "Plano via Slug" });
    const normalized = makeNormalized({
      product: { gateway_product_id: "prod-1", name: "Plano", plan_slug: "pro" },
    });
    await handleSubscriptionActivated(CLIENT, "be-1", normalized);
    expect(mockGetPlanBySlug).toHaveBeenCalledWith(CLIENT, "pro");
  });

  it("lança erro quando getPlanByGatewayProduct falha e plan_slug está ausente", async () => {
    mockGetPlanByGatewayProduct.mockRejectedValue(new Error("no mapping"));
    const normalized = makeNormalized({
      product: { gateway_product_id: "prod-1", name: "Plano" },
    });
    await expect(handleSubscriptionActivated(CLIENT, "be-1", normalized)).rejects.toThrow(
      /No plan mapping found/
    );
  });

  it("cria org, invitation e subscription quando não há convite pendente", async () => {
    await handleSubscriptionActivated(CLIENT, "be-1", makeNormalized());

    expect(mockCreateOrganizationForBilling).toHaveBeenCalled();
    expect(mockCreateInvitation).toHaveBeenCalledWith(
      CLIENT,
      expect.objectContaining({ email: "user@test.com", role: "owner" })
    );
    expect(mockCreateSubscription).toHaveBeenCalled();
  });

  it("reutiliza org existente quando há convite pendente (dedup)", async () => {
    mockFindPendingInvitationByEmail.mockResolvedValue({
      id: "existing-inv",
      organization_id: "existing-org",
    });

    await handleSubscriptionActivated(CLIENT, "be-1", makeNormalized());

    expect(mockCreateOrganizationForBilling).not.toHaveBeenCalled();
    expect(mockCreateInvitation).not.toHaveBeenCalled();
    expect(mockCreateSubscription).toHaveBeenCalledWith(
      CLIENT,
      expect.objectContaining({ organization_id: "existing-org" })
    );
  });

  it("usa slug gerado a partir do nome do customer", async () => {
    await handleSubscriptionActivated(CLIENT, "be-1", makeNormalized());

    expect(mockCreateOrganizationForBilling).toHaveBeenCalledWith(
      CLIENT,
      expect.objectContaining({ slug: "joao-silva" })
    );
  });

  it("adiciona sufixo ao slug quando já está em uso (collision detection)", async () => {
    mockIsSlugAvailable
      .mockResolvedValueOnce(false) // "joao-silva" taken
      .mockResolvedValueOnce(true); // "joao-silva-2" available

    await handleSubscriptionActivated(CLIENT, "be-1", makeNormalized());

    expect(mockCreateOrganizationForBilling).toHaveBeenCalledWith(
      CLIENT,
      expect.objectContaining({ slug: "joao-silva-2" })
    );
  });

  it("marca billing_event como processed", async () => {
    await handleSubscriptionActivated(CLIENT, "be-1", makeNormalized());

    expect(mockUpdateBillingEventStatus).toHaveBeenCalledWith(
      CLIENT,
      "be-1",
      "processed",
      expect.objectContaining({ event_type: "subscription.activated" })
    );
  });

  it("envia welcome email", async () => {
    await handleSubscriptionActivated(CLIENT, "be-1", makeNormalized());
    expect(mockSendWelcomeEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "user@test.com", invitationId: "inv-uuid" })
    );
  });

  it("falha no welcome email não propaga (non-fatal)", async () => {
    mockSendWelcomeEmail.mockRejectedValue(new Error("Resend down"));
    await expect(handleSubscriptionActivated(CLIENT, "be-1", makeNormalized())).resolves.not.toThrow();
  });
});

// ─── handleSubscriptionRenewed ────────────────────────────────────────────────

describe("handleSubscriptionRenewed", () => {
  const normalized = makeNormalized({ event_type: "subscription.renewed" });
  const subscription = { id: "sub-uuid", organization_id: "org-uuid" };

  it("lança erro quando gateway_subscription_id está ausente", async () => {
    const noSub = makeNormalized({ event_type: "subscription.renewed", subscription: undefined });
    await expect(handleSubscriptionRenewed(CLIENT, "be-2", noSub)).rejects.toThrow(
      /gateway_subscription_id/
    );
  });

  it("lança erro quando subscription não é encontrada pelo gateway_subscription_id", async () => {
    mockFindSubscriptionByGatewayId.mockResolvedValue(null);
    await expect(handleSubscriptionRenewed(CLIENT, "be-2", normalized)).rejects.toThrow(
      /no subscription found/
    );
  });

  it("atualiza status para active e marca evento como processed", async () => {
    mockFindSubscriptionByGatewayId.mockResolvedValue(subscription);
    mockUpdateSubscriptionStatus.mockResolvedValue(undefined);

    await handleSubscriptionRenewed(CLIENT, "be-2", normalized);

    expect(mockUpdateSubscriptionStatus).toHaveBeenCalledWith(CLIENT, "org-uuid", "active", expect.any(Object));
    expect(mockUpdateBillingEventStatus).toHaveBeenCalledWith(
      CLIENT,
      "be-2",
      "processed",
      expect.objectContaining({ event_type: "subscription.renewed" })
    );
  });
});

// ─── handleSubscriptionCancelled ─────────────────────────────────────────────

describe("handleSubscriptionCancelled", () => {
  const normalized = makeNormalized({ event_type: "subscription.cancelled" });
  const subscription = { id: "sub-uuid", organization_id: "org-uuid" };

  it("lança erro quando gateway_subscription_id está ausente", async () => {
    const noSub = makeNormalized({ event_type: "subscription.cancelled", subscription: undefined });
    await expect(handleSubscriptionCancelled(CLIENT, "be-3", noSub)).rejects.toThrow(
      /gateway_subscription_id/
    );
  });

  it("marca como ignored quando subscription não é encontrada", async () => {
    mockFindSubscriptionByGatewayId.mockResolvedValue(null);
    await handleSubscriptionCancelled(CLIENT, "be-3", normalized);
    expect(mockUpdateBillingEventStatus).toHaveBeenCalledWith(CLIENT, "be-3", "ignored", expect.any(Object));
    expect(mockUpdateSubscriptionStatus).not.toHaveBeenCalled();
  });

  it("cancela subscription, suspende org e marca evento como processed", async () => {
    mockFindSubscriptionByGatewayId.mockResolvedValue(subscription);
    mockUpdateSubscriptionStatus.mockResolvedValue(undefined);
    mockUpdateOrganizationOnboardingStatus.mockResolvedValue(undefined);

    await handleSubscriptionCancelled(CLIENT, "be-3", normalized);

    expect(mockUpdateSubscriptionStatus).toHaveBeenCalledWith(
      CLIENT,
      "org-uuid",
      "cancelled",
      expect.objectContaining({ cancelled_at: expect.any(String) })
    );
    expect(mockUpdateOrganizationOnboardingStatus).toHaveBeenCalledWith(CLIENT, "org-uuid", "suspended");
    expect(mockUpdateBillingEventStatus).toHaveBeenCalledWith(
      CLIENT,
      "be-3",
      "processed",
      expect.objectContaining({ event_type: "subscription.cancelled" })
    );
  });
});

// ─── handleSubscriptionPastDue ────────────────────────────────────────────────

describe("handleSubscriptionPastDue", () => {
  const normalized = makeNormalized({ event_type: "subscription.past_due" });
  const subscription = { id: "sub-uuid", organization_id: "org-uuid" };

  it("lança erro quando gateway_subscription_id está ausente", async () => {
    const noSub = makeNormalized({ event_type: "subscription.past_due", subscription: undefined });
    await expect(handleSubscriptionPastDue(CLIENT, "be-4", noSub)).rejects.toThrow(
      /gateway_subscription_id/
    );
  });

  it("marca como ignored quando subscription não é encontrada", async () => {
    mockFindSubscriptionByGatewayId.mockResolvedValue(null);
    await handleSubscriptionPastDue(CLIENT, "be-4", normalized);
    expect(mockUpdateBillingEventStatus).toHaveBeenCalledWith(CLIENT, "be-4", "ignored", expect.any(Object));
    expect(mockUpdateSubscriptionStatus).not.toHaveBeenCalled();
  });

  it("atualiza status para past_due e marca evento como processed", async () => {
    mockFindSubscriptionByGatewayId.mockResolvedValue(subscription);
    mockUpdateSubscriptionStatus.mockResolvedValue(undefined);

    await handleSubscriptionPastDue(CLIENT, "be-4", normalized);

    expect(mockUpdateSubscriptionStatus).toHaveBeenCalledWith(CLIENT, "org-uuid", "past_due");
    expect(mockUpdateBillingEventStatus).toHaveBeenCalledWith(
      CLIENT,
      "be-4",
      "processed",
      expect.objectContaining({ event_type: "subscription.past_due" })
    );
  });
});

// ─── audit log assertions ─────────────────────────────────────────────────────

describe("audit logs no worker", () => {
  const normalized = makeNormalized();

  it("(audit): handleSubscriptionActivated → registra organization.created", async () => {
    await handleSubscriptionActivated(CLIENT, "be-audit", normalized);
    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      CLIENT,
      expect.objectContaining({
        action: "organization.created",
        entity_type: "organization",
        entity_id: "org-uuid",
      })
    );
  });

  it("(audit): handleSubscriptionActivated → registra plan.activated", async () => {
    await handleSubscriptionActivated(CLIENT, "be-audit", normalized);
    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      CLIENT,
      expect.objectContaining({
        action: "plan.activated",
        entity_type: "plan",
        entity_id: "sub-uuid",
      })
    );
  });

  it("(audit): handleSubscriptionRenewed → registra plan.renewed", async () => {
    const sub = { id: "sub-uuid", organization_id: "org-uuid" };
    mockFindSubscriptionByGatewayId.mockResolvedValue(sub);
    mockUpdateSubscriptionStatus.mockResolvedValue(undefined);
    await handleSubscriptionRenewed(CLIENT, "be-audit", normalized);
    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      CLIENT,
      expect.objectContaining({
        action: "plan.renewed",
        entity_type: "plan",
        entity_id: "sub-uuid",
        organization_id: "org-uuid",
      })
    );
  });

  it("(audit): handleSubscriptionCancelled → registra plan.cancelled", async () => {
    const sub = { id: "sub-uuid", organization_id: "org-uuid" };
    mockFindSubscriptionByGatewayId.mockResolvedValue(sub);
    mockUpdateSubscriptionStatus.mockResolvedValue(undefined);
    mockUpdateOrganizationOnboardingStatus.mockResolvedValue(undefined);
    await handleSubscriptionCancelled(CLIENT, "be-audit", normalized);
    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      CLIENT,
      expect.objectContaining({
        action: "plan.cancelled",
        entity_type: "plan",
        entity_id: "sub-uuid",
        organization_id: "org-uuid",
      })
    );
  });

  it("(audit): handleSubscriptionPastDue → registra plan.past_due", async () => {
    const sub = { id: "sub-uuid", organization_id: "org-uuid" };
    mockFindSubscriptionByGatewayId.mockResolvedValue(sub);
    mockUpdateSubscriptionStatus.mockResolvedValue(undefined);
    await handleSubscriptionPastDue(CLIENT, "be-audit", normalized);
    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      CLIENT,
      expect.objectContaining({
        action: "plan.past_due",
        entity_type: "plan",
        entity_id: "sub-uuid",
        organization_id: "org-uuid",
      })
    );
  });
});

// ─── R3: organization.created falso positivo ──────────────────────────────────

describe("R3: organization.created não dispara em redelivery/existingInvitation", () => {
  it("R3: convite existente → NÃO dispara organization.created (falso positivo)", async () => {
    mockFindPendingInvitationByEmail.mockResolvedValue({
      id: "existing-inv",
      organization_id: "existing-org",
    });

    await handleSubscriptionActivated(CLIENT, "be-r3", makeNormalized());

    const orgCreatedCalls = mockCreateAuditLog.mock.calls.filter(
      (args: unknown[]) => (args[1] as { action: string })?.action === "organization.created"
    );
    expect(orgCreatedCalls).toHaveLength(0);
  });

  it("R3: sem convite existente → organization.created É disparado (caminho real)", async () => {
    mockFindPendingInvitationByEmail.mockResolvedValue(null);

    await handleSubscriptionActivated(CLIENT, "be-r3b", makeNormalized());

    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      CLIENT,
      expect.objectContaining({ action: "organization.created" })
    );
  });
});

// ─── R5: audits antes do processed mark ──────────────────────────────────────

describe("R5: audit logs escritos ANTES do billing event ser marcado como processed", () => {
  it("R5: plan.activated é auditado ANTES de updateBillingEventStatus('processed')", async () => {
    const callOrder: string[] = [];

    mockCreateAuditLog.mockImplementation((_client: unknown, params: { action: string }) => {
      callOrder.push(`audit:${params.action}`);
      return Promise.resolve({ id: "audit-uuid" });
    });
    mockUpdateBillingEventStatus.mockImplementation(
      (_c: unknown, _id: unknown, status: string) => {
        callOrder.push(`status:${status}`);
        return Promise.resolve(undefined);
      }
    );

    await handleSubscriptionActivated(CLIENT, "be-r5", makeNormalized());

    const planActivatedIdx = callOrder.indexOf("audit:plan.activated");
    const processedIdx = callOrder.indexOf("status:processed");

    expect(planActivatedIdx).toBeGreaterThanOrEqual(0);
    expect(processedIdx).toBeGreaterThanOrEqual(0);
    expect(planActivatedIdx).toBeLessThan(processedIdx);
  });

  it("R5: quando audit falha, billing event NÃO é marcado como processed", async () => {
    mockCreateAuditLog.mockRejectedValue(new Error("Audit DB write failed"));

    await expect(
      handleSubscriptionActivated(CLIENT, "be-r5b", makeNormalized())
    ).rejects.toThrow("Audit DB write failed");

    const processedCalls = mockUpdateBillingEventStatus.mock.calls.filter(
      (args: unknown[]) => args[2] === "processed"
    );
    expect(processedCalls).toHaveLength(0);
  });
});
