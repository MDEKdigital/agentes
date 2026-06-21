import { describe, it, expect, vi, beforeEach } from "vitest";

// ── hoisted mocks ─────────────────────────────────────────────────────────────
const {
  mockGetAdminClient,
  mockClaimBillingEventForProcessing,
  mockUpdateBillingEventStatus,
  mockHandleActivated,
  mockNormalizePayload,
} = vi.hoisted(() => ({
  mockGetAdminClient: vi.fn(),
  mockClaimBillingEventForProcessing: vi.fn(),
  mockUpdateBillingEventStatus: vi.fn().mockResolvedValue({}),
  mockHandleActivated: vi.fn(),
  mockNormalizePayload: vi.fn(),
}));

// Bullmq mock — captures both processor AND failed handler
const capturedHandlers: Record<string, Function> = {};
vi.mock("bullmq", () => ({
  Worker: vi.fn().mockImplementation((_name: string, processor: Function) => {
    const instance = {
      _processor: processor,
      on: vi.fn((event: string, handler: Function) => {
        capturedHandlers[event] = handler;
      }),
    };
    return instance;
  }),
}));

vi.mock("@aula-agente/database", () => ({
  getAdminClient: mockGetAdminClient,
  claimBillingEventForProcessing: mockClaimBillingEventForProcessing,
  updateBillingEventStatus: mockUpdateBillingEventStatus,
  getBillingEventById: vi.fn(),
}));

vi.mock("../../lib/redis", () => ({ getConnectionOptions: vi.fn(() => ({})) }));
vi.mock("../../normalizers/index", () => ({ normalizePayload: mockNormalizePayload }));
vi.mock("../../services/onboarding-service", () => ({
  handleSubscriptionActivated: mockHandleActivated,
  handleSubscriptionRenewed: vi.fn(),
  handleSubscriptionCancelled: vi.fn(),
  handleSubscriptionPastDue: vi.fn(),
}));

import { createBillingOnboardingWorker } from "../billing-onboarding";
import { Worker } from "bullmq";

const MockWorker = Worker as unknown as ReturnType<typeof vi.fn>;

function makeJob(billingEventId = "be-001") {
  return { data: { billingEventId }, log: vi.fn(), opts: { attempts: 3 }, attemptsMade: 1 };
}

function makeBillingEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: "be-001",
    status: "pending",
    gateway: "hotmart",
    raw_payload: {},
    updated_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(), // 10 min ago
    ...overrides,
  };
}

// Builds a chainable DB mock for the stale recovery UPDATE query
// update().eq(id).eq(status).lt(updated_at).select().single() → resolves with {data}
function makeUpdateChain(returnData: unknown) {
  const single = vi.fn().mockResolvedValue({ data: returnData, error: null });
  const selectInner = vi.fn().mockReturnValue({ single });
  const lt = vi.fn().mockReturnValue({ select: selectInner });
  const eq2 = vi.fn().mockReturnValue({ lt }); // second eq → lt
  const eq1 = vi.fn().mockReturnValue({ eq: eq2 }); // first eq → second eq
  const update = vi.fn().mockReturnValue({ eq: eq1 });
  return { update, _single: single };
}

// Builds a chainable DB mock for the status SELECT query
// select("status").eq("id", id).single() → resolves with {data}
function makeSelectChain(statusValue: string) {
  const single = vi.fn().mockResolvedValue({ data: { status: statusValue }, error: null });
  const eq = vi.fn().mockReturnValue({ single });
  const select = vi.fn().mockReturnValue({ eq });
  return { select, _single: single };
}

function makeAdminClient(opts: {
  staleReturnData?: unknown;
  currentStatus?: string;
}) {
  const updateChain = makeUpdateChain(opts.staleReturnData ?? null);
  const selectChain = makeSelectChain(opts.currentStatus ?? "processing");

  return {
    from: vi.fn((_table: string) => ({
      update: updateChain.update,
      select: selectChain.select,
    })),
    _updateSingle: updateChain._single,
    _selectSingle: selectChain._single,
  };
}

async function runProcessor(job: ReturnType<typeof makeJob>) {
  createBillingOnboardingWorker();
  const lastInst = MockWorker.mock.results[MockWorker.mock.results.length - 1].value;
  await lastInst._processor(job);
}

async function runFailedHandler(job: ReturnType<typeof makeJob>, err: Error) {
  createBillingOnboardingWorker();
  await capturedHandlers["failed"](job, err);
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.keys(capturedHandlers).forEach((k) => delete capturedHandlers[k]);
  // mockReset clears the once-queue too, preventing state leakage between tests
  mockClaimBillingEventForProcessing.mockReset();
  mockClaimBillingEventForProcessing.mockResolvedValue(null);
  mockUpdateBillingEventStatus.mockResolvedValue({});
  mockHandleActivated.mockResolvedValue(undefined);
  mockNormalizePayload.mockReturnValue({
    event_type: "subscription.activated",
    gateway: "hotmart",
    gateway_event_id: "evt-1",
    customer: { email: "x@test.com", name: "X" },
    product: { gateway_product_id: "p1", name: "Plano" },
  });
});

// ─── C12 tests ────────────────────────────────────────────────────────────────

describe("C12: billing partial state reconciliation", () => {
  // ── Caminho nominal ──────────────────────────────────────────────────────────

  it("C12: caminho nominal — evento claimed → processed → updateBillingEventStatus chamado pelo handler", async () => {
    const db = makeAdminClient({});
    mockGetAdminClient.mockReturnValue(db);
    mockClaimBillingEventForProcessing.mockResolvedValue(makeBillingEvent());

    await runProcessor(makeJob());

    expect(mockHandleActivated).toHaveBeenCalled();
  });

  it("C12: evento skipped normalmente quando já está processed (não tenta recover)", async () => {
    // Event is already processed — claim returns null — stale query returns null (not stale)
    const db = makeAdminClient({ staleReturnData: null });
    mockGetAdminClient.mockReturnValue(db);
    mockClaimBillingEventForProcessing.mockResolvedValue(null);

    const job = makeJob();
    await runProcessor(job);

    expect(mockHandleActivated).not.toHaveBeenCalled();
    expect(job.log).toHaveBeenCalledWith(expect.stringContaining("Skipping"));
  });

  // ── Stale recovery ───────────────────────────────────────────────────────────

  it("C12: evento stuck em 'processing' por >5min → recovery redefine para pending → re-claim → processado", async () => {
    // First claim: returns null (event is "processing")
    // Stale recovery: returns the event (it was stale → reset to "pending")
    // Second claim: returns the event
    const db = makeAdminClient({ staleReturnData: { id: "be-001" } });
    mockGetAdminClient.mockReturnValue(db);
    mockClaimBillingEventForProcessing
      .mockResolvedValueOnce(null) // First claim → stuck in processing
      .mockResolvedValueOnce(makeBillingEvent()); // Second claim → recovered

    await runProcessor(makeJob());

    // Handler should have been called after recovery
    expect(mockHandleActivated).toHaveBeenCalled();
    // claimBillingEventForProcessing called twice (first fail, then after recovery)
    expect(mockClaimBillingEventForProcessing).toHaveBeenCalledTimes(2);
  });

  it("C12: stale recovery não reprocessa evento recente (não stale)", async () => {
    // Stale recovery returns null → event was NOT stale (recent processing, maybe concurrent)
    const db = makeAdminClient({ staleReturnData: null });
    mockGetAdminClient.mockReturnValue(db);
    mockClaimBillingEventForProcessing.mockResolvedValue(null);

    const job = makeJob();
    await runProcessor(job);

    // Should skip — not recovered
    expect(mockHandleActivated).not.toHaveBeenCalled();
    expect(job.log).toHaveBeenCalledWith(expect.stringContaining("Skipping"));
    // claimBillingEventForProcessing called only once (no second attempt)
    expect(mockClaimBillingEventForProcessing).toHaveBeenCalledTimes(1);
  });

  // ── failed handler ───────────────────────────────────────────────────────────

  it("C12: failed handler NÃO sobrescreve evento já em 'processed' com 'failed'", async () => {
    const db = makeAdminClient({ currentStatus: "processed" });
    mockGetAdminClient.mockReturnValue(db);

    const job = makeJob();
    await runFailedHandler(job, new Error("timeout"));

    // Must NOT call updateBillingEventStatus with "failed" when already processed
    expect(mockUpdateBillingEventStatus).not.toHaveBeenCalledWith(
      expect.anything(),
      "be-001",
      "failed",
      expect.any(Object)
    );
  });

  it("C12: failed handler NÃO sobrescreve evento já em 'ignored' com 'failed'", async () => {
    const db = makeAdminClient({ currentStatus: "ignored" });
    mockGetAdminClient.mockReturnValue(db);

    await runFailedHandler(makeJob(), new Error("whatever"));

    expect(mockUpdateBillingEventStatus).not.toHaveBeenCalledWith(
      expect.anything(),
      "be-001",
      "failed",
      expect.any(Object)
    );
  });

  it("C12: failed handler MARCA como 'failed' quando evento ainda está em 'processing'", async () => {
    const db = makeAdminClient({ currentStatus: "processing" });
    mockGetAdminClient.mockReturnValue(db);

    await runFailedHandler(makeJob(), new Error("handler error"));

    expect(mockUpdateBillingEventStatus).toHaveBeenCalledWith(
      expect.anything(),
      "be-001",
      "failed",
      expect.objectContaining({ error_message: "handler error" })
    );
  });

  it("C12: processed/failed refletem realidade — evento que completou side effects não é sobrescrito", async () => {
    // This simulates: handleActivated succeeded externally (sub created, audit fired)
    // but a concurrent job's failed handler fires trying to mark it as "failed"
    const db = makeAdminClient({ currentStatus: "processed" });
    mockGetAdminClient.mockReturnValue(db);

    await runFailedHandler(makeJob(), new Error("network error"));

    // Event stays "processed" — not overwritten
    const failedCalls = mockUpdateBillingEventStatus.mock.calls.filter(
      (args) => args[2] === "failed"
    );
    expect(failedCalls).toHaveLength(0);
  });
});
