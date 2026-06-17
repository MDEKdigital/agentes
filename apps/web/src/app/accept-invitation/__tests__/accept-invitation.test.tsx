import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import React from "react";

// ── hoisted mocks ─────────────────────────────────────────────────────────────
const {
  mockUseSearchParams,
  mockRouterPush,
  mockGetUser,
  mockRpc,
  mockApiFetch,
} = vi.hoisted(() => ({
  mockUseSearchParams: vi.fn(),
  mockRouterPush: vi.fn(),
  mockGetUser: vi.fn(),
  mockRpc: vi.fn(),
  mockApiFetch: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: mockUseSearchParams,
  useRouter: () => ({ push: mockRouterPush }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { getUser: mockGetUser },
    rpc: mockRpc,
  }),
}));

vi.mock("@/lib/api", () => ({
  apiFetch: mockApiFetch,
}));

// must import AFTER mocks
import AcceptInvitationPage from "../page";

// ── helpers ───────────────────────────────────────────────────────────────────

function renderPage() {
  return render(<AcceptInvitationPage />);
}

// ── default setup ─────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  // shouldAdvanceTime: true allows waitFor (which uses setInterval internally) to work with fake timers
  vi.useFakeTimers({ shouldAdvanceTime: true });

  // Default: has id param
  const mockParams = new URLSearchParams("id=inv-uuid-1");
  mockUseSearchParams.mockReturnValue(mockParams);

  // Default: user is logged in
  mockGetUser.mockResolvedValue({ data: { user: { id: "user-1", email: "u@test.com" } } });

  // Default: RPC succeeds returning 'owner'
  mockRpc.mockResolvedValue({ data: "owner", error: null });

  // Default: apiFetch succeeds
  mockApiFetch.mockResolvedValue({ message: "Se um convite estiver disponível, o email foi reenviado." });
});

afterEach(() => {
  vi.useRealTimers();
});

// ── TASK 2: redirect condicional ──────────────────────────────────────────────

describe("accept-invitation: redirect condicional por role", () => {
  it("role 'owner' → redireciona para /onboarding após sucesso", async () => {
    mockRpc.mockResolvedValue({ data: "owner", error: null });
    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/Convite aceito/i)).toBeInTheDocument();
    });

    act(() => { vi.runAllTimers(); });
    expect(mockRouterPush).toHaveBeenCalledWith("/onboarding");
  });

  it("role 'admin' → redireciona para /inbox após sucesso", async () => {
    mockRpc.mockResolvedValue({ data: "admin", error: null });
    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/Convite aceito/i)).toBeInTheDocument();
    });

    act(() => { vi.runAllTimers(); });
    expect(mockRouterPush).toHaveBeenCalledWith("/inbox");
  });

  it("role 'agent' → redireciona para /inbox após sucesso", async () => {
    mockRpc.mockResolvedValue({ data: "agent", error: null });
    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/Convite aceito/i)).toBeInTheDocument();
    });

    act(() => { vi.runAllTimers(); });
    expect(mockRouterPush).toHaveBeenCalledWith("/inbox");
  });
});

// ── TASK 2: casos básicos ─────────────────────────────────────────────────────

describe("accept-invitation: casos básicos", () => {
  it("sem param ?id → mostra erro 'Link de convite inválido'", async () => {
    mockUseSearchParams.mockReturnValue(new URLSearchParams(""));
    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/Link de convite inválido/i)).toBeInTheDocument();
    });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("usuário não autenticado → mostra opções de criar conta e fazer login", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /criar conta/i })).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /já tenho conta/i })).toBeInTheDocument();
  });
});

// ── TASK 4: botão "Reenviar link" ─────────────────────────────────────────────

describe("accept-invitation: formulário de reenvio quando convite expirado", () => {
  it("erro 'inválido ou expirado' → mostra formulário de reenvio com campo email", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "Convite inválido ou expirado" },
    });
    renderPage();

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/seu email/i)).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: /reenviar link/i })).toBeInTheDocument();
  });

  it("preencher email e clicar 'Reenviar link' → chama POST /billing/resend-invitation", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "Convite inválido ou expirado" },
    });
    renderPage();

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/seu email/i)).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText(/seu email/i), {
      target: { value: "cliente@empresa.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /reenviar link/i }));

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith("/billing/resend-invitation", {
        method: "POST",
        body: JSON.stringify({ email: "cliente@empresa.com" }),
      });
    });
  });

  it("após reenvio bem-sucedido → mostra confirmação neutra", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "Convite inválido ou expirado" },
    });
    renderPage();

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/seu email/i)).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText(/seu email/i), {
      target: { value: "cliente@empresa.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /reenviar link/i }));

    await waitFor(() => {
      expect(screen.getByText(/email foi reenviado/i)).toBeInTheDocument();
    });
  });

  it("erro genérico (não expirado) → mostra erro simples sem formulário de reenvio", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "Organização já possui membros" },
    });
    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/Organização já possui membros/i)).toBeInTheDocument();
    });

    expect(screen.queryByPlaceholderText(/seu email/i)).not.toBeInTheDocument();
  });
});
