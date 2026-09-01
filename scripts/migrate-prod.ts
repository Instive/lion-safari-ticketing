/**
 * Applies pending migrations without the `drizzle-kit migrate` CLI.
 *
 * The CLI's spinner-based progress UI swallows the underlying error when a
 * migration attempt fails or hangs — this project hit that repeatedly on
 * Render, with every deploy log showing spinner frames and then a bare
 * "Exited with status 1", never the actual Postgres error. This calls
 * drizzle-orm's own migrator directly, over the same `pg` Pool the rest of
 * the app uses, so a real failure prints a real stack trace instead.
 *
 * Reads DATABASE_URL straight from the environment, deliberately not via
 * @/lib/env: this must run correctly even if some unrelated env var fails
 * validation, exactly like drizzle.config.ts does today.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }

  const pool = new Pool({ connectionString, connectionTimeoutMillis: 10_000 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
    console.log("[migrate] done");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[migrate] failed —", err);
  process.exit(1);
});
