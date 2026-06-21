import { getRedisConnection } from "@aula-agente/queue";

const LOCK_PREFIX = "lock:conversation:";
const ENROLLMENT_LOCK_PREFIX = "lock:remarketing:enrollment:";
const LOCK_TTL_MS = 60_000; // 60 seconds max lock
const ENROLLMENT_LOCK_TTL_MS = 30_000; // 30 seconds — one enrollment step should be fast
const RETRY_DELAY_MS = 500;
const MAX_RETRIES = 20; // 10 seconds max wait

export async function acquireConversationLock(conversationId: string): Promise<string | null> {
  const redis = getRedisConnection();
  const lockKey = `${LOCK_PREFIX}${conversationId}`;
  const lockValue = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  for (let i = 0; i < MAX_RETRIES; i++) {
    const result = await redis.set(lockKey, lockValue, "PX", LOCK_TTL_MS, "NX");
    if (result === "OK") {
      return lockValue;
    }
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
  }

  return null; // Failed to acquire lock
}

export async function releaseConversationLock(conversationId: string, lockValue: string) {
  const redis = getRedisConnection();
  const lockKey = `${LOCK_PREFIX}${conversationId}`;

  // Only release if we still hold the lock (Lua script for atomicity)
  const luaScript = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("del", KEYS[1])
    else
      return 0
    end
  `;

  try {
    await redis.call("EVAL", luaScript, "1", lockKey, lockValue);
  } catch (err) {
    console.error(`[lock] EVAL failed for ${lockKey}, attempting direct del:`, err);
    try {
      await redis.del(lockKey);
    } catch (delErr) {
      console.error(`[lock] Failed to release lock ${lockKey}:`, delErr);
    }
  }
}

// C16: distributed enrollment lock — single attempt, no retry (skip on contention)
export async function acquireEnrollmentLock(enrollmentId: string): Promise<string | null> {
  const redis = getRedisConnection();
  const lockKey = `${ENROLLMENT_LOCK_PREFIX}${enrollmentId}`;
  const lockValue = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const result = await redis.set(lockKey, lockValue, "PX", ENROLLMENT_LOCK_TTL_MS, "NX");
  return result === "OK" ? lockValue : null;
}

export async function releaseEnrollmentLock(enrollmentId: string, lockValue: string): Promise<void> {
  const redis = getRedisConnection();
  const lockKey = `${ENROLLMENT_LOCK_PREFIX}${enrollmentId}`;
  const luaScript = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("del", KEYS[1])
    else
      return 0
    end
  `;
  try {
    await redis.call("EVAL", luaScript, "1", lockKey, lockValue);
  } catch (err) {
    console.error(`[lock] Failed to release enrollment lock ${lockKey}:`, err);
  }
}
