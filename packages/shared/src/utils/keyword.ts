const CACHE_MAX_SIZE = 500;
const regexCache = new Map<string, RegExp | null>();

function getCachedRegex(keyword: string): RegExp | null {
  if (regexCache.has(keyword)) return regexCache.get(keyword) ?? null;
  if (regexCache.size >= CACHE_MAX_SIZE) {
    // Evict oldest entry (Map insertion order)
    regexCache.delete(regexCache.keys().next().value as string);
  }
  let compiled: RegExp | null;
  try {
    compiled = new RegExp(keyword, "i");
  } catch {
    compiled = null;
  }
  regexCache.set(keyword, compiled);
  return compiled;
}

/**
 * Returns true if `pattern` is a valid regex that poses no obvious ReDoS risk.
 * Rejects patterns where a group containing a quantifier is itself quantified,
 * e.g. (a+)+, (.*)*, (a|b){2,}+ — the primary source of catastrophic backtracking.
 */
export function isValidRegex(pattern: string): boolean {
  try {
    new RegExp(pattern, "i");
  } catch {
    return false;
  }
  // Heuristic: group with internal quantifier followed by outer quantifier
  if (/\([^)]*(?:[+*]|\{\d)[^)]*\)[+*?{]/.test(pattern)) {
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
