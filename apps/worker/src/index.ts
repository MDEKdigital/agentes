import "dotenv/config";

const REQUIRED_ENV = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SECRET_ENCRYPTION_KEY"] as const;
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`[startup] Variável de ambiente obrigatória ausente: ${key}`);
    process.exit(1);
  }
}

import { startProcessMessageWorker } from "./workers/process-message";
import { startSendMessageWorker } from "./workers/send-message";
import { startProcessDocumentWorker } from "./workers/process-document";
import { startTakeoverTimeoutWorker } from "./workers/takeover-timeout";

async function main() {
  console.log("Starting workers...");

  const workers = [
    startProcessMessageWorker(),
    startSendMessageWorker(),
    startProcessDocumentWorker(),
    startTakeoverTimeoutWorker(),
  ];

  console.log(`${workers.length} workers started successfully`);

  // Graceful shutdown
  const shutdown = async () => {
    console.log("Shutting down workers...");
    await Promise.all(workers.map((w) => w.close()));
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  console.error("Worker startup failed:", err);
  process.exit(1);
});
