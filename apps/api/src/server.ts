import "dotenv/config";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const WsImpl = require("ws");
if (!globalThis.WebSocket) {
  const WsClass = WsImpl.WebSocket ?? WsImpl;
  if (typeof WsClass !== "function") {
    throw new Error("[server] ws module did not export a WebSocket constructor — check bundle");
  }
  // @ts-ignore
  globalThis.WebSocket = WsClass;
}
import Fastify from "fastify";

const REQUIRED_ENV = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_ANON_KEY",
  "EVOLUTION_API_URL",
  "EVOLUTION_API_KEY",
  "WEBHOOK_SECRET",
  "PUBLIC_API_URL",
  "SECRET_ENCRYPTION_KEY",
] as const;

const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error("[startup] Missing required environment variables:");
  missing.forEach((key) => console.error(`  - ${key}`));
  process.exit(1);
}
import cors from "@fastify/cors";
import evolutionWebhookRoutes from "./routes/webhooks/evolution";
import messageSendRoutes from "./routes/messages/send";
import instanceRoutes from "./routes/instances/index";
import knowledgeDocumentRoutes from "./routes/knowledge/documents";
import knowledgeFaqRoutes from "./routes/knowledge/faqs";
import secretsRoutes from "./routes/secrets/index";
import conversationRoutes from "./routes/conversations/index";
import organizationRoutes from "./routes/organizations/index";
import remarketingRoutes from "./routes/remarketing/index";

const server = Fastify({ logger: true });

// Allow POST/PUT/PATCH requests that send Content-Type: application/json with empty body
// (happens when clients set the header unconditionally but have no payload)
server.addContentTypeParser(
  "application/json",
  { parseAs: "string" },
  (_req, body, done) => {
    if (!body || (body as string).trim() === "") {
      done(null, {});
      return;
    }
    try {
      done(null, JSON.parse(body as string));
    } catch (err) {
      done(err as Error, undefined);
    }
  }
);

// Plugins
server.register(cors, {
  origin: true,
  methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
});

// Health check
server.get("/health", { logLevel: "silent" }, async () => {
  return { status: "ok", timestamp: new Date().toISOString(), node: process.version };
});

// Routes
server.register(evolutionWebhookRoutes);
server.register(messageSendRoutes);
server.register(instanceRoutes);
server.register(knowledgeDocumentRoutes);
server.register(knowledgeFaqRoutes);
server.register(secretsRoutes);
server.register(conversationRoutes);
server.register(organizationRoutes);
server.register(remarketingRoutes);

// Start
const start = async () => {
  const port = parseInt(process.env.API_PORT || "3001", 10);
  await server.listen({ port, host: "0.0.0.0" });
  server.log.info(`API server running on port ${port}`);
};

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
