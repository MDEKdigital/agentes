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

  // Every HTTP request made by the admin client gets a hard fetch-level
  // timeout. setTimeout-based races don't cancel stuck sockets; wrapping
  // the native fetch with AbortSignal.timeout does, because Node.js aborts
  // the underlying TCP read at libuv level when the signal fires.
  const FETCH_TIMEOUT_MS = 15_000;
  const fetchWithTimeout = (input: RequestInfo | URL, init: RequestInit = {}) =>
    fetch(input, {
      ...init,
      signal: init.signal
        ? AbortSignal.any([init.signal, AbortSignal.timeout(FETCH_TIMEOUT_MS)])
        : AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

  adminClient = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: fetchWithTimeout as typeof fetch },
  });

  return adminClient;
}
