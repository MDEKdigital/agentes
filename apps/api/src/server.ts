import "dotenv/config";
// Set socket-level timeouts on ALL outbound HTTP/HTTPS requests (including those made
// by @supabase/supabase-js). AbortSignal-based timeouts only cancel Promises; they
// don't reliably close hung TCP sockets in some container environments. undici's Agent
// operates at the libuv socket layer and guarantees connections are torn down.
import { setGlobalDispatcher, Agent } from "undici";
setGlobalDispatcher(
  new Agent({
    connectTimeout: 8_000,   // abort TCP connection if not established within 8 s
    headersTimeout: 12_000,  // abort if HTTP headers not received within 12 s
    bodyTimeout: 12_000,     // abort if body read takes longer than 12 s
  })
);
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
import helmet from "@fastify/helmet";
import rateLimitPlugin from "@fastify/rate-limit";
import { parseAllowedOrigins, isOriginAllowed } from "./lib/cors";
import { helmetOptions } from "./lib/helmet";
import { parseRateLimitConfig } from "./lib/rate-limit";
import evolutionWebhookRoutes from "./routes/webhooks/evolution";
import messageSendRoutes from "./routes/messages/send";
import instanceRoutes from "./routes/instances/index";
import knowledgeDocumentRoutes from "./routes/knowledge/documents";
import knowledgeFaqRoutes from "./routes/knowledge/faqs";
import secretsRoutes from "./routes/secrets/index";
import conversationRoutes from "./routes/conversations/index";
import organizationRoutes from "./routes/organizations/index";
import remarketingRoutes from "./routes/remarketing/index";
import billingWebhookRoutes from "./routes/webhooks/billing/index";
import billingRoutes from "./routes/billing/index";
import agentRoutes from "./routes/agents/index";
import invitationRoutes from "./routes/invitations/index";
import membersRoutes from "./routes/members/index";
import contactRoutes from "./routes/contacts/index";
import productRoutes from "./routes/products/index";
import promptStudioRoutes from "./routes/prompt-studio/index";
import adminRoutes from "./routes/admin/index";
import { runMigrations } from "./lib/migrate";

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

// Rate limiting
const rateTiers = parseRateLimitConfig(process.env as Record<string, string | undefined>);
server.register(rateLimitPlugin, {
  global: true,
  max: rateTiers.defaultMax,
  timeWindow: "1 minute",
  keyGenerator: (req) => req.ip ?? "unknown",
});

// Assign per-tier rate limits via onRoute hook (runs before route is finalized)
server.addHook("onRoute", (routeOptions) => {
  const url = routeOptions.url;
  // Skip health check
  if (url === "/health") return;

  let max: number | undefined;
  if (url.startsWith("/webhooks/")) {
    max = rateTiers.webhookMax;
  } else if (url === "/messages/send") {
    max = rateTiers.messagesMax;
  } else if (
    url.includes("/invitations") ||
    url.includes("/secrets/") ||
    url === "/billing/resend-invitation"
  ) {
    max = rateTiers.sensitiveMax;
  }

  if (max !== undefined) {
    routeOptions.config = {
      ...routeOptions.config,
      rateLimit: { max, timeWindow: "1 minute" },
    };
  }
});

// Plugins
server.register(helmet, helmetOptions);

const allowedOrigins = parseAllowedOrigins(process.env.ALLOWED_ORIGINS);
server.register(cors, {
  origin: (origin, callback) => {
    if (isOriginAllowed(origin, allowedOrigins)) {
      callback(null, true);
    } else {
      callback(new Error(`Origin '${origin}' not allowed by CORS`), false);
    }
  },
  methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
});

// Health check
server.get("/health", { logLevel: "silent" }, async () => {
  return { status: "ok", timestamp: new Date().toISOString(), node: process.version, build: "timer-3s" };
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
server.register(billingWebhookRoutes);
server.register(billingRoutes);
server.register(agentRoutes);
server.register(invitationRoutes);
server.register(membersRoutes);
server.register(contactRoutes);
server.register(productRoutes);
server.register(promptStudioRoutes);
server.register(adminRoutes);

// Start
const start = async () => {
  await runMigrations();
  const port = parseInt(process.env.API_PORT || "3001", 10);
  await server.listen({ port, host: "0.0.0.0" });
  server.log.info(`API server running on port ${port}`);
};

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
