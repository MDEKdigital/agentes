import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let adminClient: SupabaseClient | null = null;

function assertWebSocket() {
  const nodeMajor = parseInt(process.version.slice(1).split(".")[0], 10);
  if (nodeMajor < 22 && !globalThis.WebSocket) {
    throw new Error(
      `[database] WebSocket unavailable on Node.js ${nodeMajor}. ` +
      "Set globalThis.WebSocket before calling getAdminClient()."
    );
  }
}

export function getAdminClient(): SupabaseClient {
  if (adminClient) return adminClient;

  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  assertWebSocket();

  // Force Connection: close on every request.
  // The production container reuses a keep-alive TCP connection from auth
  // middleware that Supabase has already half-closed on its side. Subsequent
  // requests sent on that stale socket never get a response. Sending
  // Connection: close forces a fresh TCP handshake for every fetch call,
  // eliminating the stale-connection hang entirely.
  const fetchNoKeepAlive = (input: RequestInfo | URL, init: RequestInit = {}) => {
    const headers = new Headers(init.headers as HeadersInit | undefined);
    headers.set("connection", "close");
    return fetch(input, { ...init, headers });
  };

  adminClient = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: fetchNoKeepAlive as typeof fetch },
  });

  return adminClient;
}
