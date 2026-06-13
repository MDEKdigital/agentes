const regexCache = new Map<string, RegExp | null>();

function getCachedRegex(keyword: string): RegExp | null {
  if (!regexCache.has(keyword)) {
    try {
      regexCache.set(keyword, new RegExp(keyword, "i"));
    } catch {
      regexCache.set(keyword, null);
    }
  }
  return regexCache.get(keyword) ?? null;
}

export function matchesKeyword(content: string, keywords: string[]): boolean {
  const valid = keywords.filter((k) => k.trim().length > 0);
  return valid.some((keyword) => {
    const regex = getCachedRegex(keyword);
    return regex ? regex.test(content) : false;
  });
}
