import type { FastifyRequest, FastifyReply } from "fastify";
import { getAdminClient } from "@aula-agente/database";

const AUTH_MS  = 8_000;
const QUERY_MS = 8_000;

function raceTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = setTimeout(() => reject(new Error(`Timeout: ${label}`)), ms);
    p.then(
      (v) => { clearTimeout(id); resolve(v); },
      (e) => { clearTimeout(id); reject(e); }
    );
  });
}

export async function authMiddleware(request: FastifyRequest, reply: FastifyReply) {
  const authHeader = request.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    return reply.status(401).send({ error: "Missing or invalid authorization header" });
  }

  const token = authHeader.slice(7);
  const adminClient = getAdminClient();

  // auth.getUser() doesn't expose .abortSignal(), so use Promise.race with timeout
  let user: { id: string; email?: string } | null = null;
  try {
    const { data, error } = await raceTimeout(
      adminClient.auth.getUser(token),
      AUTH_MS,
      "getUser"
    );
    if (error || !data.user) {
      return reply.status(401).send({ error: "Invalid or expired token" });
    }
    user = data.user;
  } catch (err) {
    request.log.error({ err }, "authMiddleware: getUser timed out or failed");
    return reply.status(503).send({ error: "Auth service unavailable" });
  }

  // Use AbortSignal on the DB query so the HTTP fetch is actually cancelled on timeout
  let memberships: Array<{ organization_id: string; role: string }> = [];
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), QUERY_MS);
    const { data, error: memberError } = await adminClient
      .from("organization_members")
      .select("organization_id, role")
      .eq("user_id", user.id)
      .abortSignal(ctrl.signal);
    clearTimeout(timer);
    if (memberError) {
      request.log.error({ err: memberError }, "Failed to fetch memberships");
      return reply.status(500).send({ error: "Failed to fetch user memberships" });
    }
    memberships = data || [];
  } catch (err) {
    request.log.error({ err }, "authMiddleware: memberships query timed out or failed");
    return reply.status(503).send({ error: "Database unavailable" });
  }

  request.user = {
    id: user.id,
    email: user.email ?? "",
    memberships,
  };
}

export function requireOrg(request: FastifyRequest, reply: FastifyReply) {
  const orgId = (request.params as Record<string, string>).organizationId
    || (request.body as Record<string, string>)?.organization_id
    || request.headers["x-organization-id"] as string;

  if (!orgId) {
    return reply.status(400).send({ error: "Missing organization ID" });
  }

  const membership = request.user.memberships.find(
    (m: { organization_id: string }) => m.organization_id === orgId
  );

  if (!membership) {
    return reply.status(403).send({ error: "Not a member of this organization" });
  }

  request.organizationId = orgId;
  request.userRole = membership.role;
}

declare module "fastify" {
  interface FastifyRequest {
    user: {
      id: string;
      email: string;
      memberships: Array<{ organization_id: string; role: string }>;
    };
    organizationId: string;
    userRole: string;
  }
}
