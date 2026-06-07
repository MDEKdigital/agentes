import { createClient } from "@/lib/supabase/client";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export async function apiFetch(path: string, options: RequestInit = {}) {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    throw new Error("Sessão expirada. Faça login novamente.");
  }

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
        ...options.headers,
      },
    });
  } catch {
    throw new Error(
      `Não foi possível conectar ao servidor em ${API_URL}.\nVerifique se a API está rodando.`
    );
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: "Request failed" }));
    const message = Array.isArray(body.error)
      ? body.error.map((i: { message?: string }) => i.message ?? JSON.stringify(i)).join("; ")
      : body.error || `Erro na API: ${response.status}`;
    throw new Error(message);
  }

  if (response.status === 204) return null;
  return response.json();
}
