import { createClient } from "@/lib/supabase/client";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export async function apiFetch(path: string, options: RequestInit = {}) {
  const supabase = createClient();

  // getSession() reads from local storage — no network call, always fast.
  // JWT validation is the server's job (authMiddleware calls getUser server-side).
  // Calling getUser() here made a Supabase Auth network round-trip before every
  // single API request, causing slow/rate-limited requests to chain-timeout.
  const { data: { session } } = await supabase.auth.getSession();

  if (!session) {
    throw new Error("Sessão expirada. Faça login novamente.");
  }

  const METHOD = (options.method ?? "GET").toUpperCase();
  const needsBody = ["POST", "PUT", "PATCH"].includes(METHOD);
  const body = options.body !== undefined ? options.body : needsBody ? "{}" : undefined;

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...options,
      signal: options.signal ?? AbortSignal.timeout(30_000),
      ...(body !== undefined ? { body } : {}),
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        Authorization: `Bearer ${session.access_token}`,
        ...options.headers,
      },
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "TimeoutError") {
      throw new Error("A requisição demorou demais. Tente novamente.");
    }
    throw new Error(
      `Não foi possível conectar ao servidor em ${API_URL}.\nVerifique se a API está rodando.`
    );
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: "Requisição falhou" }));
    const message = Array.isArray(body.error)
      ? body.error.map((i: { message?: string }) => i.message ?? JSON.stringify(i)).join("; ")
      : body.message || body.error || `Erro na API: ${response.status}`;
    throw new Error(message);
  }

  if (response.status === 204) return null;
  return response.json();
}
