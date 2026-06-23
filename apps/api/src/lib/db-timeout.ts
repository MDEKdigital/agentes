export const QUERY_MS = 8_000;

export class TimeoutError extends Error {
  constructor(label: string) {
    super(`DB timeout: ${label}`);
    this.name = "TimeoutError";
  }
}

export function withTimeout<T>(p: PromiseLike<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = setTimeout(() => reject(new TimeoutError(label)), ms);
    void Promise.resolve(p).then(
      (v) => { clearTimeout(id); resolve(v); },
      (e) => { clearTimeout(id); reject(e); }
    );
  });
}
