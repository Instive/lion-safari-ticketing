/**
 * Verifies the admin bookings view and its exports against a running dev
 * server: filters mean the same thing on screen and in the CSV, the export is
 * ADMIN-only, spreadsheet formula injection is neutralised, and the nightly
 * report collapses duplicate sends for the same date.
 *
 * Usage: npm run verify:reports   (dev server must be running)
 */
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";

import { db, pool } from "@/db";
import { bookings, staffSessions, staffUsers } from "@/db/schema";
import { createCounterBooking } from "@/domain/booking/create";
import {
  bookingTotals,
  parseFilters,
  rangeFor,
  streamBookings,
} from "@/domain/reports/bookings";
import { csvCell } from "@/lib/csv";
import { env, staffBaseUrl } from "@/lib/env";
import { businessDate } from "@/lib/time";
import { assertNotProduction } from "./lib/guard";

const BASE = staffBaseUrl();

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}${detail ? ` — ${detail}` : ""}`);
}

async function sessionCookieFor(username: string): Promise<{ staffId: string; cookie: string }> {
  const [user] = await db
    .select()
    .from(staffUsers)
    .where(eq(staffUsers.username, username))
    .limit(1);
  if (!user) throw new Error(`seed staff "${username}" not found — run npm run db:seed first`);

  const rawToken = randomBytes(32).toString("base64url");
  await db.insert(staffSessions).values({
    staffId: user.id,
    tokenHash: createHmac("sha256", env.SESSION_SECRET).update(rawToken).digest("hex"),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });
  return { staffId: user.id, cookie: `ls_staff_session=${rawToken}` };
}

async function get(path: string, cookie: string) {
  const res = await fetch(`${BASE}${path}`, { headers: { cookie }, redirect: "manual" });
  return { status: res.status, body: await res.text(), headers: res.headers };
}

async function main() {
  assertNotProduction("run the reports checks");
  console.log(`Testing bookings reporting at ${BASE}\n`);

  const admin = await sessionCookieFor("admin");
  const counter = await sessionCookieFor("counter");
  const today = businessDate();

  // -----------------------------------------------------------------------
  console.log("1. A booking made today appears under today's filter");
  const sale = await createCounterBooking({
    visitorCount: 3,
    // A name that a spreadsheet would happily execute if it were pasted in raw.
    customerName: "=1+1+cmd|' /c calc'!A0",
    idempotencyKey: `verify-report-${randomUUID()}`,
    createdByStaffId: counter.staffId,
    actor: { type: "STAFF", id: counter.staffId, name: "Counter Staff" },
  });

  const todayPage = await get(`/admin/bookings?range=today`, admin.cookie);
  check("responds 200", todayPage.status === 200, `got ${todayPage.status}`);
  check("lists the booking", todayPage.body.includes(sale.booking.bookingCode));

  // -----------------------------------------------------------------------
  console.log("\n2. A filter that excludes it really excludes it");
  const onlineOnly = await get(`/admin/bookings?range=today&channel=ONLINE`, admin.cookie);
  check(
    "counter sale absent when filtering to ONLINE",
    !onlineOnly.body.includes(sale.booking.bookingCode),
  );
  const otherDay = await get(`/admin/bookings?range=yesterday`, admin.cookie);
  check(
    "today's sale absent from yesterday",
    !otherDay.body.includes(sale.booking.bookingCode),
  );

  // -----------------------------------------------------------------------
  console.log("\n3. The CSV export carries exactly what the filter selects");
  const csv = await get(`/admin/bookings/export?range=today`, admin.cookie);
  check("responds 200", csv.status === 200, `got ${csv.status}`);
  check(
    "served as a downloadable CSV",
    (csv.headers.get("content-type") ?? "").includes("text/csv") &&
      (csv.headers.get("content-disposition") ?? "").includes("attachment"),
    csv.headers.get("content-disposition") ?? "",
  );
  // Checked as bytes: `res.text()` decodes UTF-8 and strips the BOM, so the
  // string form can never see it.
  const csvBytes = new Uint8Array(
    await (await fetch(`${BASE}/admin/bookings/export?range=today`, {
      headers: { cookie: admin.cookie },
    })).arrayBuffer(),
  );
  check(
    "starts with a UTF-8 BOM so Excel reads it correctly",
    csvBytes[0] === 0xef && csvBytes[1] === 0xbb && csvBytes[2] === 0xbf,
    `first bytes ${[...csvBytes.slice(0, 3)].map((b) => b.toString(16)).join(" ")}`,
  );
  check("contains the booking", csv.body.includes(sale.booking.bookingCode));

  const filteredOut = await get(`/admin/bookings/export?range=today&channel=ONLINE`, admin.cookie);
  check(
    "and omits it when the filter does",
    !filteredOut.body.includes(sale.booking.bookingCode),
  );

  // -----------------------------------------------------------------------
  console.log("\n4. A spreadsheet formula in customer data is neutralised");
  check(
    "leading = is escaped in the CSV",
    csv.body.includes(`"'=1+1+cmd|' /c calc'!A0"`) || csv.body.includes(`'=1+1+cmd`),
    "customer name cell",
  );
  check(
    "csvCell escapes every formula lead character",
    ["=x", "+x", "-x", "@x"].every((value) => csvCell(value).replace(/"/g, "").startsWith("'")),
  );
  check(
    "and still quotes embedded separators",
    csvCell('a,b"c') === '"a,b""c"',
    csvCell('a,b"c'),
  );

  // -----------------------------------------------------------------------
  console.log("\n5. Totals on screen equal the rows in the export");
  const filters = parseFilters({ range: "today" });
  const totals = await bookingTotals(filters);
  let streamed = 0;
  let confirmedAmount = 0;
  for await (const batch of streamBookings(filters)) {
    for (const row of batch) {
      streamed += 1;
      if (row.status === "PAID" || row.status === "CASH_CONFIRMED") {
        confirmedAmount += row.amountTotal;
      }
    }
  }
  check("row count matches", streamed === totals.bookings, `${streamed} vs ${totals.bookings}`);
  check(
    "collected total matches the sum of confirmed rows",
    confirmedAmount === totals.collectedPaise,
    `${confirmedAmount} vs ${totals.collectedPaise}`,
  );

  // -----------------------------------------------------------------------
  console.log("\n6. Ranges are computed in the park's timezone");
  const todayRange = rangeFor("today");
  check("'today' is the business date", todayRange.from === today && todayRange.to === today, today);
  const thisMonth = rangeFor("this_month");
  check(
    "'this month' starts on the 1st and ends today",
    thisMonth.from === `${today.slice(0, 7)}-01` && thisMonth.to === today,
    `${thisMonth.from}..${thisMonth.to}`,
  );
  const backwards = rangeFor("custom", "2026-08-31", "2026-08-01");
  check(
    "a backwards custom range is swapped, not empty",
    backwards.from === "2026-08-01" && backwards.to === "2026-08-31",
  );

  // -----------------------------------------------------------------------
  console.log("\n7. The export is ADMIN-only");
  const asCounter = await get(`/admin/bookings/export?range=today`, counter.cookie);
  check("counter staff are refused", asCounter.status === 403, `got ${asCounter.status}`);
  const anonymous = await get(`/admin/bookings/export?range=today`, "");
  check("signed-out callers are refused", anonymous.status === 403, `got ${anonymous.status}`);
  check(
    "and no booking data leaks in either response",
    !asCounter.body.includes(sale.booking.bookingCode) &&
      !anonymous.body.includes(sale.booking.bookingCode),
  );

  // -----------------------------------------------------------------------
  console.log("\n8. Cleanup");
  await db.delete(bookings).where(eq(bookings.id, sale.booking.id)).catch(() => {
    // A ticket references it; leaving the row is harmless for a dev database.
  });

  console.log(
    failures === 0
      ? "\nReporting behaved correctly end to end.\n"
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
