// Portas comuns em ambiente local de desenvolvimento.
// Usado como fallback quando ALLOWED_ORIGINS não está configurado.
const LOCALHOST_DEFAULTS = [
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:3002",
  "http://localhost:4000",
  "http://localhost:5173",
  "http://localhost:8080",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:3001",
  "http://127.0.0.1:3002",
  "http://127.0.0.1:4000",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:8080",
];

/**
 * Converte o valor de ALLOWED_ORIGINS (CSV) em um array de origens.
 * Sem valor (dev) → retorna localhost defaults.
 * Com valor (produção) → retorna exatamente as origens listadas.
 * Localhost NÃO é adicionado automaticamente em produção.
 */
export function parseAllowedOrigins(envValue?: string): string[] {
  if (!envValue || envValue.trim() === "") {
    return LOCALHOST_DEFAULTS;
  }
  return envValue
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}

/**
 * Determina se uma requisição com o Origin dado deve receber headers CORS.
 *
 * - origin undefined/vazio → permitido (requisição servidor-a-servidor, curl,
 *   health checks — sem cabeçalho Origin = não é um browser cross-origin).
 * - origin na lista → permitido.
 * - qualquer outro → bloqueado.
 */
export function isOriginAllowed(
  origin: string | undefined,
  allowed: string[]
): boolean {
  if (!origin) return true;
  return allowed.includes(origin);
}
