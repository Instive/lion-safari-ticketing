import { createHmac, randomBytes } from "node:crypto";
import { and, eq, gt, lt } from "drizzle-orm";
import { cookies } from "next/headers";

import { db } from "@/db";
import { staffSessions, staffUsers, type StaffRole } from "@/db/schema";
import { env } from "@/lib/env";

export const SESSION_COOKIE = "ls_staff_session";

/**
 * Staff sessions are server-side rows, not stateless tokens: deactivating a
 * staff member or revoking a device must take effect on the very next request
 * (spec §12 — automatic session expiry / device logout).
 */
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // one shift

/**
 * The cookie holds a 256-bit random token; the database holds only its HMAC.
 * A leaked database dump therefore cannot be used to forge a live session.
 */
function tokenDigest(rawToken: string): string {
  return createHmac("sha256", env.SESSION_SECRET).update(rawToken).digest("hex");
}

export type SessionStaff = {
  sessionId: string;
  id: string;
  name: string;
  username: string;
  role: StaffRole;
};

export async function createSession(
  staffId: string,
  meta: { userAgent?: string | null; ip?: string | null } = {},
): Promise<void> {
  const rawToken = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await db.insert(staffSessions).values({
    staffId,
    tokenHash: tokenDigest(rawToken),
    expiresAt,
    userAgent: meta.userAgent ?? null,
    ip: meta.ip ?? null,
  });

  const jar = await cookies();
  jar.set(SESSION_COOKIE, rawToken, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

/**
 * Resolves the current staff member, or null. Rejects expired sessions and
 * users who have since been deactivated.
 */
export async function getSessionStaff(): Promise<SessionStaff | null> {
  const jar = await cookies();
  const rawToken = jar.get(SESSION_COOKIE)?.value;
  if (!rawToken) return null;

  const rows = await db
    .select({
      sessionId: staffSessions.id,
      id: staffUsers.id,
      name: staffUsers.name,
      username: staffUsers.username,
      role: staffUsers.role,
      active: staffUsers.active,
    })
    .from(staffSessions)
    .innerJoin(staffUsers, eq(staffUsers.id, staffSessions.staffId))
    .where(
      and(
        eq(staffSessions.tokenHash, tokenDigest(rawToken)),
        gt(staffSessions.expiresAt, new Date()),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row || !row.active) return null;

  // Best-effort activity tracking; never block the request on it.
  void db
    .update(staffSessions)
    .set({ lastSeenAt: new Date() })
    .where(eq(staffSessions.id, row.sessionId))
    .catch(() => {});

  return {
    sessionId: row.sessionId,
    id: row.id,
    name: row.name,
    username: row.username,
    role: row.role,
  };
}

export async function destroyCurrentSession(): Promise<void> {
  const jar = await cookies();
  const rawToken = jar.get(SESSION_COOKIE)?.value;
  if (rawToken) {
    await db.delete(staffSessions).where(eq(staffSessions.tokenHash, tokenDigest(rawToken)));
  }
  jar.delete(SESSION_COOKIE);
}

/** Revokes every session for a staff member — used when deactivating an account. */
export async function revokeAllSessionsFor(staffId: string): Promise<void> {
  await db.delete(staffSessions).where(eq(staffSessions.staffId, staffId));
}

export async function purgeExpiredSessions(): Promise<number> {
  const result = await db.delete(staffSessions).where(lt(staffSessions.expiresAt, new Date()));
  return result.rowCount ?? 0;
}

/** Rough client IP for audit records. Never used for authorization. */
export function clientIpFrom(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return headers.get("x-real-ip");
}
