import { getRedisConnection } from "@aula-agente/queue";

export const HEALTH_CHECK_TIMEOUT_MS = 3_000;

type HealthStatus = { redis: "up" | "down" };

export async function checkRedisHealth(
  timeoutMs = HEALTH_CHECK_TIMEOUT_MS
): Promise<HealthStatus> {
  const redis = getRedisConnection();
  try {
    await Promise.race([
      redis.ping(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Redis ping timeout")), timeoutMs)
      ),
    ]);
    return { redis: "up" };
  } catch {
    return { redis: "down" };
  }
}

interface MinimalRes {
  writeHead(status: number, headers?: Record<string, string>): void;
  end(body: string): void;
}

export async function handleHealthRequest(
  res: MinimalRes,
  timeoutMs?: number
): Promise<void> {
  const health = await checkRedisHealth(timeoutMs);
  const isHealthy = health.redis === "up";
  res.writeHead(isHealthy ? 200 : 503, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      status: isHealthy ? "ok" : "degraded",
      redis: health.redis,
    })
  );
}
