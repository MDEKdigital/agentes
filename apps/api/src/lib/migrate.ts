import { Client } from "pg";
import { readFileSync, readdirSync } from "fs";
import { resolve } from "path";

const MIGRATIONS_DIR = resolve(__dirname, "../../migrations");

export async function runMigrations(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.warn("[migrate] DATABASE_URL not set — skipping auto-migrations");
    return;
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const { rows } = await client.query<{ name: string }>(
      "SELECT name FROM schema_migrations ORDER BY name"
    );
    const applied = new Set(rows.map((r) => r.name));

    let files: string[];
    try {
      files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
    } catch {
      console.warn(`[migrate] migrations dir not found at ${MIGRATIONS_DIR} — skipping`);
      return;
    }

    const pending = files.filter((f) => !applied.has(f));

    if (pending.length === 0) {
      console.log("[migrate] no pending migrations");
      return;
    }

    console.log(`[migrate] applying ${pending.length} migration(s): ${pending.join(", ")}`);

    for (const file of pending) {
      const sql = readFileSync(resolve(MIGRATIONS_DIR, file), "utf-8");
      console.log(`[migrate] applying ${file}...`);
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
      console.log(`[migrate] ✓ ${file}`);
    }

    console.log("[migrate] all migrations applied");
  } finally {
    await client.end();
  }
}
