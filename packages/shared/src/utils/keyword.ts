const CACHE_MAX_SIZE = 500;
// Cache stores only valid RegExp instances — null is never stored.
const regexCache = new Map<string, RegExp>();

function getCachedRegex(keyword: string): RegExp | null {
  const cached = regexCache.get(keyword);
  if (cached !== undefined) return cached;
  if (regexCache.size >= CACHE_MAX_SIZE) {
    regexCache.delete(regexCache.keys().next().value as string);
  }
  try {
    const compiled = new RegExp(keyword, "i");
    regexCache.set(keyword, compiled);
    return compiled;
  } catch {
    // Do not cache failures — invalid patterns should not reach here
    // if isValidRegex is enforced in the Zod schema.
    return null;
  }
}

/**
 * Returns true if `pattern` is a valid regex that poses no obvious ReDoS risk.
 * Rejects:
 *   1. Groups with an internal quantifier followed by an outer quantifier: (a+)+
 *   2. Groups with alternation followed by an outer quantifier: (a|aa)+
 */
export function isValidRegex(pattern: string): boolean {
  try {
    new RegExp(pattern, "i");
  } catch {
    return false;
  }
  // Heuristic 1: internal quantifier + outer quantifier → (a+)+
  if (/\([^)]*(?:[+*]|\{\d)[^)]*\)[+*?{]/.test(pattern)) {
    return false;
  }
  // Heuristic 2: alternation inside group + outer quantifier → (a|aa)+
  if (/\([^)]*\|[^)]*\)[+*{]/.test(pattern)) {
    return false;
  }
  return true;
}

export function matchesKeyword(content: string, keywords: string[]): boolean {
  return keywords.some((k) => {
    if (!k.trim()) return false;
    const regex = getCachedRegex(k);
    return regex ? regex.test(content) : false;
  });
}
