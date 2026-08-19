/**
 * Verifies the staff authorization boundary (spec §12: least privilege,
 * immediate revocation) against a running dev server.
 *
 * Usage: npm run verify:auth
 */
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";

import { db, pool } from "@/db";
import { staffSessions, staffUsers, type StaffRole } from "@/db/schema";
import { hashPassword } from "@/lib/auth/password";
import { env, staffBaseUrl } from "@/lib/env";

const BASE = staffBaseUrl();

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}${detail ? ` — ${detail}` : ""}`);
}

/** Mints a real session the same way the login action does. */
async function sessionFor(role: StaffRole): Promise<{ staffId: string; cookie: string }> {
  const username = `verify-${role.toLowerCase()}-${randomUUID().slice(0, 8)}`;
  const [user] = await db
    .insert(staffUsers)
    .values({
      name: `Verify ${role}`,
      username,
      role,
      passwordHash: await hashPassword("verification-password-123"),
    })
    .returning();

  const rawToken = randomBytes(32).toString("base64url");
  const tokenHash = createHmac("sha256", env.SESSION_SECRET).update(rawToken).digest("hex");

  await db.insert(staffSessions).values({
    staffId: user!.id,
    tokenHash,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });

  return { staffId: user!.id, cookie: `ls_staff_session=${rawToken}` };
}

/** Follows no redirects, so we can observe the redirect itself. */
async function visit(path: string, cookie?: string) {
  const res = await fetch(`${BASE}${path}`, {
    headers: cookie ? { cookie } : {},
    redirect: "manual",
  });
  return { status: res.status, location: res.headers.get("location") };
}

async function main() {
  console.log(`Testing authorization at ${BASE}\n`);

  const admin = await sessionFor("ADMIN");
  const counter = await sessionFor("COUNTER");
  const scanner = await sessionFor("SCANNER");

  // ---------------------------------------------------------------------
  console.log("1. Signed-out visitors cannot reach staff screens");
  for (const path of ["/admin", "/admin/staff", "/counter", "/counter/lookup"]) {
    const res = await visit(path);
    check(
      `${path} redirects to login`,
      res.status === 307 && (res.location?.includes("/login") ?? false),
      `${res.status} → ${res.location}`,
    );
  }

  // ---------------------------------------------------------------------
  console.log("\n2. Admin can reach every staff screen");
  for (const path of ["/admin", "/admin/bookings", "/admin/staff", "/admin/devices", "/counter"]) {
    const res = await visit(path, admin.cookie);
    check(`${path} allowed`, res.status === 200, `got ${res.status}`);
  }

  // ---------------------------------------------------------------------
  console.log("\n3. Counter staff can sell but cannot reach admin screens");
  const counterOwn = await visit("/counter", counter.cookie);
  check("/counter allowed", counterOwn.status === 200, `got ${counterOwn.status}`);

  for (const path of ["/admin", "/admin/staff", "/admin/devices", "/admin/reconciliation"]) {
    const res = await visit(path, counter.cookie);
    check(
      `${path} denied`,
      res.status === 307 && (res.location?.includes("denied") ?? false),
      `${res.status} → ${res.location}`,
    );
  }

  // ---------------------------------------------------------------------
  console.log("\n4. Scanner staff can reach neither the counter nor admin");
  for (const path of ["/admin", "/counter"]) {
    const res = await visit(path, scanner.cookie);
    check(
      `${path} denied`,
      res.status === 307 && (res.location?.includes("denied") ?? false),
      `${res.status} → ${res.location}`,
    );
  }

  // ---------------------------------------------------------------------
  console.log("\n5. A forged session cookie is worthless");
  const forged = await visit("/admin", `ls_staff_session=${randomBytes(32).toString("base64url")}`);
  check(
    "random token redirects to login",
    forged.status === 307 && (forged.location?.includes("/login") ?? false),
    `${forged.status} → ${forged.location}`,
  );

  // ---------------------------------------------------------------------
  console.log("\n6. Deactivating a staff member locks them out immediately");
  const before = await visit("/counter", counter.cookie);
  check("counter works before deactivation", before.status === 200, `got ${before.status}`);

  await db.update(staffUsers).set({ active: false }).where(eq(staffUsers.id, counter.staffId));

  const after = await visit("/counter", counter.cookie);
  check(
    "same cookie is refused after deactivation",
    after.status === 307 && (after.location?.includes("/login") ?? false),
    `${after.status} → ${after.location}`,
  );

  // ---------------------------------------------------------------------
  console.log("\n7. An expired session is refused");
  const expiredToken = randomBytes(32).toString("base64url");
  await db.insert(staffSessions).values({
    staffId: admin.staffId,
    tokenHash: createHmac("sha256", env.SESSION_SECRET).update(expiredToken).digest("hex"),
    expiresAt: new Date(Date.now() - 1000),
  });
  const expired = await visit("/admin", `ls_staff_session=${expiredToken}`);
  check(
    "expired session redirects to login",
    expired.status === 307 && (expired.location?.includes("/login") ?? false),
    `${expired.status} → ${expired.location}`,
  );

  console.log(
    failures === 0
      ? "\nAuthorization boundary held on every check.\n"
      : `\n${failures} check(s) FAILED.\n`,
  );
  if (failures > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
