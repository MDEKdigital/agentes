const counters: Record<string, number> = {};

export function incrementMetric(name: string, by = 1): void {
  counters[name] = (counters[name] ?? 0) + by;
}

export function getMetricsSnapshot(): Readonly<Record<string, number>> {
  return { ...counters };
}

export function resetMetricsForTests(): void {
  for (const key of Object.keys(counters)) {
    delete counters[key];
  }
}
