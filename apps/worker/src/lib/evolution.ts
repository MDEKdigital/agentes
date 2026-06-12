function getEvolutionApiUrl(): string {
  const url = process.env.EVOLUTION_API_URL;
  if (!url) throw new Error("EVOLUTION_API_URL env var is not set");
  return url;
}

function getEvolutionApiKey(): string {
  const key = process.env.EVOLUTION_API_KEY;
  if (!key) throw new Error("EVOLUTION_API_KEY env var is not set");
  return key;
}

export async function evolutionPost(path: string, body: unknown): Promise<void> {
  const response = await fetch(`${getEvolutionApiUrl()}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: getEvolutionApiKey(),
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Evolution API error ${response.status}: ${text}`);
  }
}

export async function evolutionPostJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${getEvolutionApiUrl()}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: getEvolutionApiKey(),
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Evolution API error ${response.status}: ${text}`);
  }
  return response.json() as Promise<T>;
}
