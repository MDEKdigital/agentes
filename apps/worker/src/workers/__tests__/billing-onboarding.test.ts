import { describe, it, expect, vi, beforeEach } from "vitest";

// ── hoisted mocks ─────────────────────────────────────────────────────────────
const {
  mockGetBillingEventById,
  mockUpdateBillingEventStatus,
  mockClaimBillingEventForProcessing,
  mockGetAdminClient,
  mockNormalizePayload,
  mockHandleActivated,
  mockHandleRenewed,
  mockHandleCancelled,
  mockHandlePastDue,
} = vi.hoisted(() => ({
  mockGetBillingEventById: vi.fn(),
  mockUpdateBillingEventStatus: vi.fn(),
  mockClaimBillingEventForProcessing: vi.fn(),
  mockGetAdminClient: vi.fn(() => ({})),
  mockNormalizePayload: vi.fn(),
  mockHandleActivated: vi.fn(),
  mockHandleRenewed: vi.fn(),
  mockHandleCancelled: vi.fn(),
  mockHandlePastDue: vi.fn(),
}));

vi.mock("bullmq", () => ({
  Worker: vi.fn().mockImplementation((_name: string, processor: Function) => ({
    on: vi.fn(),
    _processor: processor,
  })),
}));

vi.mock("@aula-agente/database", () => ({
  getAdminClient: mockGetAdminClient,
  getBillingEventById: mockGetBillingEventById,
  updateBillingEventStatus: mockUpdateBillingEventStatus,
  claimBillingEventForProcessing: mockClaimBillingEventForProcessing,
}));

vi.mock("../lib/redis", () => ({
  getConnectionOptions: vi.fn(() => ({})),
}));

// Resolve worker's relative import "../../lib/redis" path
vi.mock("../../lib/redis", () => ({
  getConnectionOptions: vi.fn(() => ({})),
}));

vi.mock("../../normalizers/index", () => ({
  normalizePayload: mockNormalizePayload,
}));

vi.mock("../../services/onboarding-service", () => ({
  handleSubscriptionActivated: mockHandleActivated,
  handleSubscriptionRenewed: mockHandleRenewed,
  handleSubscriptionCancelled: mockHandleCancelled,
  handleSubscriptionPastDue: mockHandlePastDue,
}));

import { createBillingOnboardingWorker } from "../billing-onboarding";
import { Worker } from "bullmq";

const MockWorker = Worker as unknown as { mock: { results: Array<{ value: { _processor: (job: unknown) => Promise<void> } }> } };

function makeJob(billingEventId: string) {
  return { data: { billingEventId }, log: vi.fn() };
}

function makeBillingEvent(overrides: Partial<{ status: string; gateway: string }> = {}) {
  return {
    id: "be-001",
    status: "pending",
    gateway: "hotmart",
    raw_payload: { event: "PURCHASE_APPROVED" },
    ...overrides,
  };
}

function makeNormalized(event_type: string) {
  return {
    event_type,
    gateway: "hotmart",
    gateway_event_id: "evt-1",
    customer: { email: "x@test.com", name: "X" },
    product: { gateway_product_id: "p1", name: "Plano" },
  };
}

async function runProcessor(job: ReturnType<typeof makeJob>) {
  createBillingOnboardingWorker();
  const lastResult = MockWorker.mock.results[MockWorker.mock.results.length - 1];
  await lastResult.value._processor(job);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createBillingOnboardingWorker", () => {
  it("cria Worker com concurrency 5 e nome correto", () => {
    createBillingOnboardingWorker();
    const workerCtor = Worker as unknown as ReturnType<typeof vi.fn>;
    expect(workerCtor).toHaveBeenCalledWith(
      "billing-onboarding",
      expect.any(Function),
      expect.objectContaining({ concurrency: 5 })
    );
  });

  it("pula eventos que não estão pending (idempotência)", async () => {
    // R4: claimBillingEventForProcessing returns null when event is already claimed/processed
    mockClaimBillingEventForProcessing.mockResolvedValue(null);
    const job = makeJob("be-001");
    await runProcessor(job);
    expect(mockUpdateBillingEventStatus).not.toHaveBeenCalled();
    expect(mockHandleActivated).not.toHaveBeenCalled();
    expect(job.log).toHaveBeenCalledWith(expect.stringContaining("Skipping"));
  });

  it("claim atômico: claimBillingEventForProcessing é chamado com o billingEventId correto", async () => {
    mockClaimBillingEventForProcessing.mockResolvedValue(makeBillingEvent());
    mockNormalizePayload.mockReturnValue(makeNormalized("subscription.activated"));
    mockHandleActivated.mockResolvedValue(undefined);

    const job = makeJob("be-001");
    await runProcessor(job);

    expect(mockClaimBillingEventForProcessing).toHaveBeenCalledWith(
      expect.anything(),
      "be-001"
    );
  });

  it("despacha subscription.activated para handleSubscriptionActivated", async () => {
    const event = makeBillingEvent();
    mockClaimBillingEventForProcessing.mockResolvedValue(event);
    const normalized = makeNormalized("subscription.activated");
    mockNormalizePayload.mockReturnValue(normalized);
    mockHandleActivated.mockResolvedValue(undefined);

    await runProcessor(makeJob("be-001"));

    expect(mockHandleActivated).toHaveBeenCalledWith(expect.anything(), "be-001", normalized);
    expect(mockHandleRenewed).not.toHaveBeenCalled();
  });

  it("despacha subscription.renewed para handleSubscriptionRenewed", async () => {
    mockClaimBillingEventForProcessing.mockResolvedValue(makeBillingEvent());
    const normalized = makeNormalized("subscription.renewed");
    mockNormalizePayload.mockReturnValue(normalized);
    mockHandleRenewed.mockResolvedValue(undefined);

    await runProcessor(makeJob("be-001"));

    expect(mockHandleRenewed).toHaveBeenCalledWith(expect.anything(), "be-001", normalized);
  });

  it("despacha subscription.cancelled para handleSubscriptionCancelled", async () => {
    mockClaimBillingEventForProcessing.mockResolvedValue(makeBillingEvent());
    const normalized = makeNormalized("subscription.cancelled");
    mockNormalizePayload.mockReturnValue(normalized);
    mockHandleCancelled.mockResolvedValue(undefined);

    await runProcessor(makeJob("be-001"));

    expect(mockHandleCancelled).toHaveBeenCalledWith(expect.anything(), "be-001", normalized);
  });

  it("despacha subscription.past_due para handleSubscriptionPastDue", async () => {
    mockClaimBillingEventForProcessing.mockResolvedValue(makeBillingEvent());
    const normalized = makeNormalized("subscription.past_due");
    mockNormalizePayload.mockReturnValue(normalized);
    mockHandlePastDue.mockResolvedValue(undefined);

    await runProcessor(makeJob("be-001"));

    expect(mockHandlePastDue).toHaveBeenCalledWith(expect.anything(), "be-001", normalized);
  });

  it("subscription.reactivated chama handleSubscriptionRenewed", async () => {
    mockClaimBillingEventForProcessing.mockResolvedValue(makeBillingEvent());
    const normalized = makeNormalized("subscription.reactivated");
    mockNormalizePayload.mockReturnValue(normalized);
    mockHandleRenewed.mockResolvedValue(undefined);

    await runProcessor(makeJob("be-001"));

    expect(mockHandleRenewed).toHaveBeenCalled();
  });

  it("refund.processed marca como ignored sem chamar handlers", async () => {
    mockClaimBillingEventForProcessing.mockResolvedValue(makeBillingEvent());
    const normalized = makeNormalized("refund.processed");
    mockNormalizePayload.mockReturnValue(normalized);

    await runProcessor(makeJob("be-001"));

    expect(mockHandleActivated).not.toHaveBeenCalled();
    expect(mockHandleRenewed).not.toHaveBeenCalled();
    expect(mockUpdateBillingEventStatus).toHaveBeenCalledWith(
      expect.anything(),
      "be-001",
      "ignored",
      expect.any(Object)
    );
  });

  it("unknown marca como ignored", async () => {
    mockClaimBillingEventForProcessing.mockResolvedValue(makeBillingEvent());
    const normalized = makeNormalized("unknown");
    mockNormalizePayload.mockReturnValue(normalized);

    await runProcessor(makeJob("be-001"));

    expect(mockUpdateBillingEventStatus).toHaveBeenCalledWith(
      expect.anything(),
      "be-001",
      "ignored",
      expect.any(Object)
    );
  });
});

// ─── R4: TOCTOU — atomic claim ────────────────────────────────────────────────

describe("R4: proteção TOCTOU — claimBillingEventForProcessing atômico", () => {
  it("R4: claim retorna null → nenhum handler é executado (worker já processou)", async () => {
    // claimBillingEventForProcessing returns null = event was already claimed by another worker
    mockClaimBillingEventForProcessing.mockResolvedValue(null);
    // getBillingEventById would return pending if called — but with R4 fix it should NOT be called
    mockGetBillingEventById.mockResolvedValue(makeBillingEvent({ status: "pending" }));
    mockNormalizePayload.mockReturnValue(makeNormalized("subscription.activated"));
    mockHandleActivated.mockResolvedValue(undefined);

    const job = makeJob("be-001");
    await runProcessor(job);

    expect(mockHandleActivated).not.toHaveBeenCalled();
    expect(mockHandleRenewed).not.toHaveBeenCalled();
    expect(mockHandleCancelled).not.toHaveBeenCalled();
    expect(mockHandlePastDue).not.toHaveBeenCalled();
    expect(job.log).toHaveBeenCalledWith(expect.stringContaining("Skipping"));
  });

  it("R4: claim retorna evento → processamento prossegue normalmente", async () => {
    const event = makeBillingEvent();
    mockClaimBillingEventForProcessing.mockResolvedValue(event);
    mockNormalizePayload.mockReturnValue(makeNormalized("subscription.activated"));
    mockHandleActivated.mockResolvedValue(undefined);

    await runProcessor(makeJob("be-001"));

    expect(mockHandleActivated).toHaveBeenCalledWith(
      expect.anything(),
      "be-001",
      expect.objectContaining({ event_type: "subscription.activated" })
    );
  });
});
