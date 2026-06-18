import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import React from "react";

// ── hoisted mocks ─────────────────────────────────────────────────────────────
const { mockApiFetch, mockUseParams, mockRouterPush, mockCreateClient, mockGetSession } = vi.hoisted(() => ({
  mockApiFetch: vi.fn(),
  mockUseParams: vi.fn(),
  mockRouterPush: vi.fn(),
  mockCreateClient: vi.fn(),
  mockGetSession: vi.fn(),
}));

vi.mock("@/lib/api", () => ({ apiFetch: mockApiFetch }));
vi.mock("next/navigation", () => ({
  useParams: mockUseParams,
  useRouter: () => ({ push: mockRouterPush }),
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: mockCreateClient }));
vi.mock("@/providers/organization-provider", () => ({
  useOrganization: () => ({ currentOrg: { id: "org-uuid-1" } }),
}));

vi.mock("@/components/remarketing/flow-form", () => ({
  FlowForm: ({ agents, instances }: { agents: { id: string; name: string }[]; instances: { id: string; instance_name: string }[] }) =>
    React.createElement("div", { "data-testid": "flow-form" },
      ...(agents ?? []).map((a) =>
        React.createElement("span", { key: a.id, "data-testid": `agent-item-${a.id}` }, a.name)
      ),
      ...(instances ?? []).map((i) =>
        React.createElement("span", { key: i.id, "data-testid": `instance-item-${i.id}` }, i.instance_name)
      ),
    ),
}));
vi.mock("@/components/remarketing/steps-editor", () => ({
  StepsEditor: () => React.createElement("div", { "data-testid": "steps-editor" }),
}));

import FlowEditPage from "../page";

const ORG_ID = "org-uuid-1";
const FLOW_ID = "flow-uuid-1";

const AGENTS_FIXTURE = {
  agents: [
    { id: "agent-1", name: "Bot Vendas" },
    { id: "agent-2", name: "Bot Suporte" },
  ],
};

const INSTANCES_FIXTURE = [
  { id: "inst-1", instance_name: "WhatsApp Principal" },
  { id: "inst-2", instance_name: "WhatsApp Vendas" },
];

const FLOWS_FIXTURE = [
  { id: FLOW_ID, name: "Fluxo Teste", status: "inactive" },
];

const STEPS_FIXTURE = [
  { id: "step-1", flow_id: FLOW_ID, step_order: 1, message: "Olá!" },
];

// ── setup ─────────────────────────────────────────────────────────────────────
beforeEach(() => {
  mockApiFetch.mockReset();
  mockCreateClient.mockReset();
  mockRouterPush.mockReset();
  mockUseParams.mockReset();
  mockGetSession.mockReset();
  mockCreateClient.mockReturnValue({
    auth: { getSession: mockGetSession },
  });
  mockGetSession.mockResolvedValue({ data: { session: { access_token: "tok" } } });
});

// ── testes — modo edição ──────────────────────────────────────────────────────
describe("FlowEditPage — modo edição (flowId existente)", () => {
  beforeEach(() => {
    mockUseParams.mockReturnValue({ flowId: FLOW_ID });
    mockApiFetch
      .mockResolvedValueOnce(AGENTS_FIXTURE)    // GET /organizations/:orgId/agents
      .mockResolvedValueOnce(INSTANCES_FIXTURE) // GET /organizations/:orgId/instances
      .mockResolvedValueOnce(FLOWS_FIXTURE)     // GET /remarketing/flows
      .mockResolvedValueOnce(STEPS_FIXTURE);    // GET /remarketing/flows/:id/steps
  });

  it("A: busca agentes via apiFetch com orgId", async () => {
    render(<FlowEditPage />);
    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(`/organizations/${ORG_ID}/agents`);
    });
  });

  it("B: busca instâncias via apiFetch com orgId", async () => {
    render(<FlowEditPage />);
    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(`/organizations/${ORG_ID}/instances`);
    });
  });

  it("C: createClient não é chamado para consultas de dados", async () => {
    render(<FlowEditPage />);
    await waitFor(() => {
      expect(screen.getByTestId("flow-form")).toBeInTheDocument();
    }, { timeout: 3000 });
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it("D: passa agentes e instâncias para FlowForm", async () => {
    render(<FlowEditPage />);
    await waitFor(() => {
      expect(screen.getByTestId("agent-item-agent-1")).toBeInTheDocument();
    }, { timeout: 3000 });
    expect(screen.getByTestId("agent-item-agent-2")).toBeInTheDocument();
    expect(screen.getByTestId("instance-item-inst-1")).toBeInTheDocument();
    expect(screen.getByTestId("instance-item-inst-2")).toBeInTheDocument();
  });
});

// ── testes — modo criação ─────────────────────────────────────────────────────
describe("FlowEditPage — modo criação (flowId = new)", () => {
  beforeEach(() => {
    mockUseParams.mockReturnValue({ flowId: "new" });
    mockApiFetch
      .mockResolvedValueOnce(AGENTS_FIXTURE)
      .mockResolvedValueOnce(INSTANCES_FIXTURE);
  });

  it("E: busca agentes e instâncias mesmo no modo criação", async () => {
    render(<FlowEditPage />);
    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(`/organizations/${ORG_ID}/agents`);
      expect(mockApiFetch).toHaveBeenCalledWith(`/organizations/${ORG_ID}/instances`);
    });
  });
});
