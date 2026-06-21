export const EVOLUTION_TIMEOUT_MS = 30_000;

async function evolutionFetch(path: string, body: unknown): Promise<Response> {
  const url = process.env.EVOLUTION_API_URL;
  if (!url) throw new Error("EVOLUTION_API_URL env var is not set");
  const key = process.env.EVOLUTION_API_KEY;
  if (!key) throw new Error("EVOLUTION_API_KEY env var is not set");

  const response = await fetch(`${url}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: key },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(EVOLUTION_TIMEOUT_MS),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Evolution API error ${response.status}: ${text}`);
  }
  return response;
}

export async function evolutionPost(path: string, body: unknown): Promise<void> {
  const response = await evolutionFetch(path, body);
  await response.body?.cancel();
}

export async function evolutionPostJson<T>(path: string, body: unknown): Promise<T> {
  const response = await evolutionFetch(path, body);
  return response.json() as Promise<T>;
}
