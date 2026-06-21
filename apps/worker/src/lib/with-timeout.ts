export const LLM_TIMEOUT_MS = 120_000;
export const VALIDATION_TIMEOUT_MS = 30_000;
export const DOCUMENT_FETCH_TIMEOUT_MS = 60_000;
export const EMBEDDING_TIMEOUT_MS = 60_000;
export const EMAIL_TIMEOUT_MS = 10_000;

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`LLM call timed out after ${ms}ms`)),
      ms
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer!));
}
