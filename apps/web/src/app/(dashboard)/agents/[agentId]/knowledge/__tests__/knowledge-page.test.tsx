import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import React from "react";

// ── hoisted mocks ─────────────────────────────────────────────────────────────
const { mockUseOrganization, mockApiFetch, mockUseParams, mockCreateClient } = vi.hoisted(() => ({
  mockUseOrganization: vi.fn(),
  mockApiFetch: vi.fn(),
  mockUseParams: vi.fn(),
  mockCreateClient: vi.fn(),
}));

vi.mock("@/providers/organization-provider", () => ({
  useOrganization: mockUseOrganization,
}));

vi.mock("@/lib/api", () => ({
  apiFetch: mockApiFetch,
}));

vi.mock("next/navigation", () => ({
  useParams: mockUseParams,
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: mockCreateClient,
}));

vi.mock("@/components/agents/document-upload", () => ({
  DocumentUpload: ({ documents }: { documents: unknown[] }) =>
    React.createElement("div", { "data-testid": "document-upload" }, `docs:${documents.length}`),
}));

vi.mock("@/components/agents/faq-manager", () => ({
  FaqManager: ({ faqs }: { faqs: unknown[] }) =>
    React.createElement("div", { "data-testid": "faq-manager" }, `faqs:${faqs.length}`),
}));

vi.mock("next/link", () => ({
  default: ({ children }: { children: React.ReactNode }) =>
    React.createElement("a", {}, children),
}));

import KnowledgePage from "../page";

// ── fixtures ──────────────────────────────────────────────────────────────────
const ORG_ID = "org-uuid-1";
const AGENT_ID = "agent-uuid-1";
const mockOrg = { id: ORG_ID, name: "Empresa Teste" };

const mockDocuments = [
  { id: "doc-1", agent_id: AGENT_ID, title: "Manual" },
  { id: "doc-2", agent_id: AGENT_ID, title: "FAQ" },
];

const mockFaqs = [{ id: "faq-1", agent_id: AGENT_ID, question: "O que é?", answer: "É isso." }];

// ── setup ─────────────────────────────────────────────────────────────────────
beforeEach(() => {
  vi.clearAllMocks();
  mockUseOrganization.mockReturnValue({ currentOrg: mockOrg });
  mockUseParams.mockReturnValue({ agentId: AGENT_ID });
  mockApiFetch
    .mockResolvedValueOnce(mockDocuments)
    .mockResolvedValueOnce(mockFaqs);
});

// ── testes ────────────────────────────────────────────────────────────────────
describe("KnowledgePage", () => {
  it("A: busca documentos via apiFetch com organizationId no path", async () => {
    render(<KnowledgePage />);

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(
        `/organizations/${ORG_ID}/agents/${AGENT_ID}/documents`
      );
    });
  });

  it("B: busca FAQs via apiFetch com organizationId no path", async () => {
    render(<KnowledgePage />);

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(
        `/organizations/${ORG_ID}/agents/${AGENT_ID}/faqs`
      );
    });
  });

  it("C: passa documentos e FAQs para os componentes filhos", async () => {
    render(<KnowledgePage />);

    await waitFor(() => {
      expect(screen.getByTestId("document-upload")).toHaveTextContent("docs:2");
      expect(screen.getByTestId("faq-manager")).toHaveTextContent("faqs:1");
    });
  });

  it("D: Supabase createClient não é chamado", async () => {
    render(<KnowledgePage />);

    await waitFor(() => {
      expect(screen.getByTestId("document-upload")).toBeInTheDocument();
    });

    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it("E: não faz fetch enquanto currentOrg não estiver disponível", () => {
    mockUseOrganization.mockReturnValue({ currentOrg: null });

    render(<KnowledgePage />);

    expect(mockApiFetch).not.toHaveBeenCalled();
  });
});
