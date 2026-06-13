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
 *   3. Nested groups where an inner group has a quantifier and the outer group also quantifies: ((a+))+
 *
 * Uses iterative group peeling with markers (\x01 for quantified, \x02 for plain) to detect
 * nested quantified patterns that single-pass regex heuristics would miss.
 */
export function isValidRegex(pattern: string): boolean {
  try {
    new RegExp(pattern, "i");
  } catch {
    return false;
  }

  // Iteratively peel innermost groups to detect nested ReDoS like ((a+))+.
  // \x01 marks a stripped group that contained a quantifier.
  // \x02 marks a stripped group that did not.
  let s = pattern;
  for (let pass = 0; pass < pattern.length; pass++) {
    // Heuristic 1: (a+)+ — group with internal quantifier and outer quantifier
    if (/\([^()]*(?:[+*]|\{\d+)[^()]*\)[+*{]/.test(s)) return false;
    // Heuristic 2: (a|aa)+ — alternation inside group with outer quantifier
    if (/\([^()]*\|[^()]*\)[+*{]/.test(s)) return false;
    // After stripping, \x01 is a formerly-quantified group; outer quantifier = nested ReDoS
    if (/\x01[+*{]/.test(s)) return false;

    const next = s.replace(/\([^()]*\)/g, (m) => {
      const inner = m.slice(1, -1);
      return /[+*]|\{\d+/.test(inner) || inner.includes('\x01') ? '\x01' : '\x02';
    });
    if (next === s) break; // no more groups to strip
    s = next;
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
