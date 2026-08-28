import { sql } from "drizzle-orm";

import { db } from "@/db";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Used by Render's health check to decide whether a new deploy is actually
 * ready before routing traffic to it, and to detect a running instance that
 * has lost its database connection.
 */
export async function GET(): Promise<Response> {
  try {
    await db.execute(sql`select 1`);
    return Response.json({ status: "ok" });
  } catch (err) {
    log.error("health", "database check failed", err);
    return Response.json({ status: "unhealthy" }, { status: 503 });
  }
}
