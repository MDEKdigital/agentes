export type RateLimitTiers = {
  defaultMax: number;
  webhookMax: number;
  messagesMax: number;
  sensitiveMax: number;
};

const DEFAULTS: RateLimitTiers = {
  defaultMax: 100,
  webhookMax: 120,
  messagesMax: 30,
  sensitiveMax: 10,
};

function parseTier(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function parseRateLimitConfig(env: Record<string, string | undefined>): RateLimitTiers {
  return {
    defaultMax: parseTier(env["RATE_LIMIT_DEFAULT"], DEFAULTS.defaultMax),
    webhookMax: parseTier(env["RATE_LIMIT_WEBHOOK"], DEFAULTS.webhookMax),
    messagesMax: parseTier(env["RATE_LIMIT_MESSAGES"], DEFAULTS.messagesMax),
    sensitiveMax: parseTier(env["RATE_LIMIT_SENSITIVE"], DEFAULTS.sensitiveMax),
  };
}
