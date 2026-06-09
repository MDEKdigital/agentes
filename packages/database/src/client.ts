import { createClient } from "@supabase/supabase-js";

export function createSupabaseClient(url: string, anonKey: string) {
  const nodeMajor = parseInt(process.version.slice(1).split(".")[0], 10);
  if (nodeMajor < 22 && !globalThis.WebSocket) {
    throw new Error(
      `[database] WebSocket unavailable on Node.js ${nodeMajor}. ` +
      "Set globalThis.WebSocket before calling createSupabaseClient()."
    );
  }
  return createClient(url, anonKey);
}
