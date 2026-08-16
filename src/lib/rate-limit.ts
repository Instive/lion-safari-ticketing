import { RateLimiterPostgres, type RateLimiterRes } from "rate-limiter-flexible";

import { pool } from "@/db";

/**
 * Rate limits for the endpoints that expose ticket data (spec §12): they are
 * what stands between a booking code and an attacker enumerating them.
 *
 * Postgres-backed so limits hold across restarts and across processes without
 * introducing Redis.
 */
const limiters = new Map<string, RateLimiterPostgres>();

function limiter(key: string, points: number, durationSeconds: number): RateLimiterPostgres {
  const existing = limiters.get(key);
  if (existing) return existing;

  const created = new RateLimiterPostgres({
    storeClient: pool,
    tableName: "rate_limits",
    // Created by migration, so the limiter never issues DDL on a live request.
    tableCreated: true,
    keyPrefix: key,
    points,
    duration: durationSeconds,
  });
  limiters.set(key, created);
  return created;
}

export type RateLimitOutcome = { allowed: true } | { allowed: false; retryAfterSeconds: number };

async function consume(
  limiterKey: string,
  identifier: string,
  points: number,
  durationSeconds: number,
): Promise<RateLimitOutcome> {
  try {
    await limiter(limiterKey, points, durationSeconds).consume(identifier);
    return { allowed: true };
  } catch (err) {
    if (err && typeof err === "object" && "msBeforeNext" in err) {
      const res = err as RateLimiterRes;
      return { allowed: false, retryAfterSeconds: Math.ceil(res.msBeforeNext / 1000) };
    }
    // A limiter outage must not take the site down; log and allow through.
    console.error("[rate-limit] limiter unavailable", err);
    return { allowed: true };
  }
}

/** Viewing a ticket by booking code — the brute-force surface. */
export function limitTicketLookup(ip: string): Promise<RateLimitOutcome> {
  return consume("ticket-lookup", ip, 20, 60);
}

/** The recovery form, which also reveals whether a code exists. */
export function limitTicketRecovery(ip: string): Promise<RateLimitOutcome> {
  return consume("ticket-recovery", ip, 8, 60);
}
