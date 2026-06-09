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

  adminClient = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  return adminClient;
}
