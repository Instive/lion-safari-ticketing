import { and, eq, gte, sql } from "drizzle-orm";

import { db } from "@/db";
import { loginAttempts, staffUsers } from "@/db/schema";
import { verifyPassword } from "./password";

const WINDOW_MINUTES = 15;
const MAX_FAILURES = 8;

/**
 * Brute-force protection (spec §12). Counts recent failures per username; a
 * successful login clears the slate by virtue of the window advancing.
 */
async function recentFailureCount(username: string): Promise<number> {
  const since = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000);
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(loginAttempts)
    .where(
      and(
        eq(loginAttempts.username, username),
        eq(loginAttempts.successful, false),
        gte(loginAttempts.at, since),
      ),
    );
  return row?.count ?? 0;
}

export type LoginResult =
  | { ok: true; staffId: string }
  | { ok: false; reason: "INVALID" | "LOCKED" | "INACTIVE" };

export async function attemptLogin(
  username: string,
  password: string,
  ip: string | null,
): Promise<LoginResult> {
  const normalized = username.trim().toLowerCase();

  if ((await recentFailureCount(normalized)) >= MAX_FAILURES) {
    await db.insert(loginAttempts).values({ username: normalized, ip, successful: false });
    return { ok: false, reason: "LOCKED" };
  }

  const [user] = await db
    .select()
    .from(staffUsers)
    .where(eq(staffUsers.username, normalized))
    .limit(1);

  // Always run a verification so a missing user and a wrong password take a
  // similar amount of time — no username enumeration via response timing.
  const digest =
    user?.passwordHash ??
    "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHR2YWx1ZQ$0000000000000000000000000000000000000000000";
  const passwordOk = await verifyPassword(digest, password);

  if (!user || !passwordOk) {
    await db.insert(loginAttempts).values({ username: normalized, ip, successful: false });
    return { ok: false, reason: "INVALID" };
  }

  if (!user.active) {
    await db.insert(loginAttempts).values({ username: normalized, ip, successful: false });
    return { ok: false, reason: "INACTIVE" };
  }

  await db.insert(loginAttempts).values({ username: normalized, ip, successful: true });
  return { ok: true, staffId: user.id };
}
