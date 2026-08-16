import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { env } from "@/lib/env";
import * as schema from "./schema";

/**
 * The pool and the Drizzle instance are both created lazily, on first use.
 *
 * `next build` imports every module to collect page data, so constructing the
 * pool at module scope would require a real DATABASE_URL just to compile. Every
 * page here is dynamic and touches the database only per-request, so deferring
 * construction lets a build run without production secrets.
 */
const globalForDb = globalThis as unknown as { __pool?: Pool };

let poolInstance: Pool | null = null;
let dbInstance: ReturnType<typeof createDb> | null = null;

function createPool(): Pool {
  return new Pool({
    connectionString: env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
}

function realPool(): Pool {
  if (!poolInstance) {
    // Cached on globalThis so Next.js hot reloads in dev don't leak connections.
    poolInstance = globalForDb.__pool ?? createPool();
    if (env.NODE_ENV !== "production") globalForDb.__pool = poolInstance;
  }
  return poolInstance;
}

function createDb() {
  return drizzle(realPool(), { schema });
}

function realDb(): ReturnType<typeof createDb> {
  dbInstance ??= createDb();
  return dbInstance;
}

/** Defers construction until a property is actually read. */
function lazy<T extends object>(resolve: () => T): T {
  return new Proxy({} as T, {
    get(_target, property) {
      const instance = resolve() as unknown as Record<string | symbol, unknown>;
      const value = instance[property];
      // Bind methods so `this` is the real instance, not the proxy.
      return typeof value === "function" ? value.bind(instance) : value;
    },
    has(_target, property) {
      return property in (resolve() as unknown as object);
    },
  });
}

export const pool: Pool = lazy(realPool);
export const db: ReturnType<typeof createDb> = lazy(realDb);
export { schema };

export type Db = ReturnType<typeof createDb>;
/** A transaction handle, for domain functions that must run inside one. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** Either the pool or an open transaction — for helpers that work with both. */
export type DbOrTx = Db | Tx;
