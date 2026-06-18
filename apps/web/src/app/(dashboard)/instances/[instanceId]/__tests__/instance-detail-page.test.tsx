import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import React from "react";

// ── hoisted mocks ─────────────────────────────────────────────────────────────
const { mockApiFetch, mockRouterPush, mockUseParams, mockCreateClient } = vi.hoisted(() => ({
  mockApiFetch: vi.fn(),
  mockRouterPush: vi.fn(),
  mockUseParams: vi.fn(),
  mockCreateClient: vi.fn(),
}));

vi.mock("@/lib/api", () => ({ apiFetch: mockApiFetch }));
vi.mock("next/navigation", () => ({
  useParams: mockUseParams,
  useRouter: () => ({ push: mockRouterPush }),
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: mockCreateClient }));

vi.mock("@/components/instances/qrcode-dialog", () => ({
  QrCodeDialog: () => React.createElement("div", { "data-testid": "qrcode-dialog" }),
}));
vi.mock("@/components/instances/pairing-code-dialog", () => ({
  PairingCodeDialog: () => React.createElement("div", { "data-testid": "pairing-dialog" }),
}));
vi.mock("@/components/instances/instance-status", () => ({
  InstanceStatus: () => React.createElement("div", { "data-testid": "instance-status" }),
}));
vi.mock("@/components/instances/profile-card", () => ({
  ProfileCard: () => React.createElement("div", { "data-testid": "profile-card" }),
}));
vi.mock("@/components/instances/settings-card", () => ({
  SettingsContent: () => React.createElement("div", { "data-testid": "settings-card" }),
}));
vi.mock("@/components/instances/privacy-card", () => ({
  PrivacyContent: () => React.createElement("div", { "data-testid": "privacy-card" }),
}));
vi.mock("@/components/instances/advanced-card", () => ({
  AdvancedContent: () => React.createElement("div", { "data-testid": "advanced-card" }),
}));
vi.mock("next/link", () => ({
  default: ({ children }: { children: React.ReactNode }) => React.createElement("a", {}, children),
}));

import InstanceDetailPage from "../page";

// ── fixtures ──────────────────────────────────────────────────────────────────
const INST_ID = "inst-uuid-1";
const ORG_ID = "org-uuid-1";

const INSTANCE_FIXTURE = {
  id: INST_ID,
  organization_id: ORG_ID,
  instance_name: "whatsapp-principal",
  status: "connected",
  phone_number: "+5511999999999",
  active_agent_id: null,
};

const AGENTS_FIXTURE = {
  agents: [
    { id: "agent-1", name: "Bot Vendas", is_active: true },
    { id: "agent-2", name: "Bot Suporte", is_active: true },
  ],
};

const STATUS_FIXTURE = {
  status: "connected",
  phone_number: "+5511999999999",
};

// ── setup ─────────────────────────────────────────────────────────────────────
beforeEach(() => {
  vi.clearAllMocks();
  mockUseParams.mockReturnValue({ instanceId: INST_ID });
  mockApiFetch
    .mockResolvedValueOnce(INSTANCE_FIXTURE)        // GET /instances/:id
    .mockResolvedValueOnce(AGENTS_FIXTURE)           // GET /organizations/:orgId/agents
    .mockResolvedValueOnce(STATUS_FIXTURE);          // GET /instances/:id/status
});

// ── testes ────────────────────────────────────────────────────────────────────
describe("InstanceDetailPage", () => {
  it("A: busca instância via apiFetch com instanceId no path", async () => {
    render(<InstanceDetailPage />);

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(`/instances/${INST_ID}`);
    });
  });

  it("B: busca agentes via apiFetch usando organization_id da instância", async () => {
    render(<InstanceDetailPage />);

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(
        `/organizations/${ORG_ID}/agents`
      );
    });
  });

  it("C: createClient não é chamado para buscar dados", async () => {
    render(<InstanceDetailPage />);

    await waitFor(() => {
      expect(screen.getByText("whatsapp-principal")).toBeInTheDocument();
    });

    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it("D: exibe nome da instância após carregar", async () => {
    render(<InstanceDetailPage />);

    await waitFor(() => {
      expect(screen.getByText("whatsapp-principal")).toBeInTheDocument();
    });
  });

  it("E: exibe agentes no select após carregar", async () => {
    render(<InstanceDetailPage />);

    await waitFor(() => {
      expect(screen.getByText("Agente Vinculado")).toBeInTheDocument();
    });
  });
});
