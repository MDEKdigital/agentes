export function getConnectionOptions() {
  const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
  return { url: redisUrl };
}
