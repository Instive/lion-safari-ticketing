/**
 * Applies pending migrations without drizzle-orm's built-in migrator.
 *
 * drizzle-orm@0.45.2's `migrate()` (node_modules/drizzle-orm/pg-core/dialect.js,
 * `PgDialect.migrate`) wraps EVERY pending migration file into a single
 * transaction. That breaks this project's own migration history: 0003 adds
 * 'RESERVED' to the booking_status enum, and 0004 compares against that same
 * value (`status <> 'RESERVED'`) — Postgres refuses to use an enum value
 * added earlier in an uncommitted transaction ("unsafe use of new value",
 * hint: "New enum values must be committed before they can be used."). This
 * only surfaces when both files run in the same batch, which only happens on
 * a fresh/empty database — production applied them across separate deploys
 * and never hit it. `drizzle-kit migrate` (the CLI) calls this exact same
 * code path, so it hit the identical error on every attempt; its spinner-based
 * UI just never printed it (see the note in render.yaml).
 *
 * This applies each migration file in its OWN transaction instead — 0003
 * commits before 0004 starts — while reusing drizzle-orm's own
 * `readMigrationFiles` and its exact tracking-table shape (schema `drizzle`,
 * table `__drizzle_migrations`, same hash/created_at columns), so it reads
 * and writes the identical history `drizzle-kit migrate` already left behind
 * on every environment. Nothing here is a new migration system — same files,
 * same order, same bookkeeping, just committed once per file.
 *
 * Reads DATABASE_URL straight from the environment, deliberately not via
 * @/lib/env: this must run correctly even if some unrelated env var fails
 * validation, exactly like drizzle.config.ts does today.
 */
import { readMigrationFiles } from "drizzle-orm/migrator";
import { Pool, type PoolClient } from "pg";

const MIGRATIONS_SCHEMA = "drizzle";
const MIGRATIONS_TABLE = "__drizzle_migrations";

async function ensureMigrationsTable(client: PoolClient) {
  await client.query(`CREATE SCHEMA IF NOT EXISTS "${MIGRATIONS_SCHEMA}"`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}" (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `);
}

async function lastAppliedMillis(client: PoolClient): Promise<number> {
  const { rows } = await client.query<{ created_at: string | null }>(
    `SELECT created_at FROM "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}" ORDER BY created_at DESC LIMIT 1`,
  );
  return rows[0]?.created_at ? Number(rows[0].created_at) : -1;
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }

  const migrations = readMigrationFiles({ migrationsFolder: "./drizzle" });
  const pool = new Pool({ connectionString, connectionTimeoutMillis: 10_000 });
  const client = await pool.connect();

  try {
    await ensureMigrationsTable(client);
    let lastMillis = await lastAppliedMillis(client);
    let applied = 0;

    for (const migration of migrations) {
      if (migration.folderMillis <= lastMillis) continue;

      await client.query("BEGIN");
      try {
        for (const statement of migration.sql) {
          await client.query(statement);
        }
        await client.query(
          `INSERT INTO "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}" (hash, created_at) VALUES ($1, $2)`,
          [migration.hash, migration.folderMillis],
        );
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }

      console.log(`[migrate] applied ${migration.hash.slice(0, 12)} (${migration.folderMillis})`);
      lastMillis = migration.folderMillis;
      applied++;
    }

    console.log(applied > 0 ? `[migrate] done — applied ${applied}` : "[migrate] done — nothing to apply");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[migrate] failed —", err);
  process.exit(1);
});
