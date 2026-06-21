export type LogLevel = "info" | "warn" | "error";

export function workerLog(
  worker: string,
  level: LogLevel,
  fields: Record<string, string | number | undefined>,
  message: string
): void {
  const fieldStr = Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(" ");
  const line = fieldStr ? `[${worker}] ${fieldStr} ${message}` : `[${worker}] ${message}`;
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}
