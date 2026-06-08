import "dotenv/config";
import { createServer } from "node:http";

const REQUIRED_ENV = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SECRET_ENCRYPTION_KEY",
  "REDIS_URL",
  "EVOLUTION_API_URL",
  "EVOLUTION_API_KEY",
] as const;

const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error("[startup] Missing required environment variables:");
  missing.forEach((key) => console.error(`  - ${key}`));
  process.exit(1);
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

  // Minimal HTTP server so container orchestrators (EasyPanel, k8s, etc.)
  // can health-check this background process
  const healthPort = parseInt(process.env.HEALTH_PORT || "3001", 10);
  const healthServer = createServer((req, res) => {
    if (req.url === "/health" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", timestamp: new Date().toISOString() }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  healthServer.listen(healthPort, "0.0.0.0", () => {
    console.log(`Health server listening on port ${healthPort}`);
  });

  const shutdown = async () => {
    console.log("Shutting down workers...");
    healthServer.close();
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
