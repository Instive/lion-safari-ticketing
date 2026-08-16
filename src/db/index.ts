import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { env } from "@/lib/env";
import * as schema from "./schema";

/**
 * A single pool per process. Cached on globalThis so Next.js hot reloads in dev
 * don't leak connections.
 */
const globalForDb = globalThis as unknown as { __pool?: Pool };

const pool =
  globalForDb.__pool ??
  new Pool({
    connectionString: env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

if (env.NODE_ENV !== "production") globalForDb.__pool = pool;

export const db = drizzle(pool, { schema });
export { pool, schema };

export type Db = typeof db;
/** A transaction handle, for domain functions that must run inside one. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** Either the pool or an open transaction — for helpers that work with both. */
export type DbOrTx = Db | Tx;
