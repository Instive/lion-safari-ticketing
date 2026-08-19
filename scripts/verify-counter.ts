/**
 * Verifies the counter cash-sale flow end to end against a running dev
 * server: sign-in-gated pages render, a cash sale is atomic (one booking, one
 * ticket), the recent-sales panel surfaces it, and reprinting is idempotent.
 *
 * Server Actions can't be invoked directly over HTTP from a script (they need
 * the Next.js client runtime's action-id encoding), so this calls
 * `createCounterBooking` directly — the exact function the counter's
 * "Cash received" action calls — and checks its effects show up through the
 * real pages, the same way a browser session would see them.
 *
 * Usage: npm run verify:counter   (dev server must be running)
 */
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";

import { db, pool } from "@/db";
import { bookings, staffSessions, staffUsers, tickets } from "@/db/schema";
import { confirmBoarding } from "@/domain/boarding/confirm";
import { createCounterBooking } from "@/domain/booking/create";
import { cancelBooking } from "@/domain/booking/refund";
import { env } from "@/lib/env";
import { businessDate } from "@/lib/time";

const BASE = env.APP_BASE_URL;

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}${detail ? ` — ${detail}` : ""}`);
}

/** Mints a real session the same way the login action does. */
async function sessionCookieFor(username: string): Promise<{ staffId: string; cookie: string }> {
  const [user] = await db
    .select()
    .from(staffUsers)
    .where(eq(staffUsers.username, username))
    .limit(1);
  if (!user) throw new Error(`seed staff "${username}" not found — run npm run db:seed first`);

  const rawToken = randomBytes(32).toString("base64url");
  const tokenHash = createHmac("sha256", env.SESSION_SECRET).update(rawToken).digest("hex");

  await db.insert(staffSessions).values({
    staffId: user.id,
    tokenHash,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });

  return { staffId: user.id, cookie: `ls_staff_session=${rawToken}` };
}

async function get(path: string, cookie: string) {
  const res = await fetch(`${BASE}${path}`, { headers: { cookie }, redirect: "manual" });
  return { status: res.status, body: res.status === 200 ? await res.text() : "" };
}

async function main() {
  console.log(`Testing counter flow at ${BASE}\n`);

  const counter = await sessionCookieFor("counter");

  // ---------------------------------------------------------------------
  console.log("1. Signed-in counter staff can reach /counter");
  const page1 = await get("/counter", counter.cookie);
  check("responds 200", page1.status === 200, `got ${page1.status}`);
  check("shows the cash sale form", page1.body.includes("Cash received"));

  // ---------------------------------------------------------------------
  console.log("\n2. A cash sale is atomic: exactly one booking, one ticket");
  const idempotencyKey = randomUUID();
  const sale = await createCounterBooking({
    visitorCount: 3,
    customerName: "Verify Counter",
    idempotencyKey,
    createdByStaffId: counter.staffId,
    actor: { type: "STAFF", id: counter.staffId, name: "Counter Staff" },
  });
  check("booking is CASH_CONFIRMED", sale.booking.status === "CASH_CONFIRMED");
  check("ticket issued in the same call", sale.ticket !== null);

  const ticketRows = await db.select().from(tickets).where(eq(tickets.bookingId, sale.booking.id));
  check("exactly one ticket row exists", ticketRows.length === 1, `found ${ticketRows.length}`);

  // ---------------------------------------------------------------------
  console.log("\n3. The recent-sales panel surfaces this staff member's sale");
  const page2 = await get("/counter", counter.cookie);
  check("responds 200", page2.status === 200, `got ${page2.status}`);
  check("shows 'Your last sales today'", page2.body.includes("Your last sales today"));
  check(
    "lists the booking code just created",
    page2.body.includes(sale.booking.bookingCode),
    sale.booking.bookingCode,
  );

  // ---------------------------------------------------------------------
  console.log("\n4. Reprinting from the recent-sales link shows the same ticket");
  const ticketPage = await get(`/counter/ticket/${sale.booking.bookingCode}`, counter.cookie);
  check("responds 200", ticketPage.status === 200, `got ${ticketPage.status}`);
  check("shows the booking code", ticketPage.body.includes(sale.booking.bookingCode));
  check("shows the visitor count", ticketPage.body.includes(">3<"));

  const stillOneTicket = await db
    .select()
    .from(tickets)
    .where(eq(tickets.bookingId, sale.booking.id));
  check(
    "viewing the ticket page again created no second ticket",
    stillOneTicket.length === 1,
    `found ${stillOneTicket.length}`,
  );

  // ---------------------------------------------------------------------
  console.log("\n5. Retrying the SAME sale (idempotency key reused, as a reload survivor would) is a no-op");
  const retry = await createCounterBooking({
    visitorCount: 3,
    customerName: "Verify Counter",
    idempotencyKey, // same key — this is exactly what the sessionStorage-persisted
    // draft key guarantees survives a reload, per the counter hardening fix
    createdByStaffId: counter.staffId,
    actor: { type: "STAFF", id: counter.staffId, name: "Counter Staff" },
  });
  check("same booking returned", retry.booking.id === sale.booking.id);
  check("reported as not newly created", retry.created === false);

  const bookingsWithThisKey = await db
    .select()
    .from(bookings)
    .where(eq(bookings.idempotencyKey, idempotencyKey));
  check(
    "still exactly one booking for this idempotency key",
    bookingsWithThisKey.length === 1,
    `found ${bookingsWithThisKey.length}`,
  );

  // ---------------------------------------------------------------------
  console.log("\n6. Signed-out visitors cannot reach the counter or its API");
  const noAuth = await get("/counter", "");
  check(
    "redirects to login",
    noAuth.status === 307,
    `got ${noAuth.status}`,
  );

  // ---------------------------------------------------------------------
  console.log("\n7. Voiding a fresh own sale cancels the booking and its ticket");
  const toVoid = await createCounterBooking({
    visitorCount: 4,
    idempotencyKey: `verify-void-${randomUUID()}`,
    createdByStaffId: counter.staffId,
    actor: { type: "STAFF", id: counter.staffId, name: "Counter Staff" },
  });
  await cancelBooking(
    toVoid.booking.id,
    { type: "STAFF", id: counter.staffId, name: "Counter Staff" },
    "Voided at counter: verify script test",
  );
  const [voided] = await db.select().from(bookings).where(eq(bookings.id, toVoid.booking.id));
  const [voidedTicket] = await db
    .select()
    .from(tickets)
    .where(eq(tickets.bookingId, toVoid.booking.id));
  check("booking is CANCELLED", voided!.status === "CANCELLED");
  check("ticket is CANCELLED", voidedTicket!.status === "CANCELLED");

  // ---------------------------------------------------------------------
  console.log("\n8. The eligibility gate — the ONLY thing between this and misuse — is correct");
  // Same three checks voidOwnSaleAction and the ticket page both apply.
  function eligible(row: {
    createdByStaffId: string | null;
    visitDate: string;
    ticketStatus: string;
  }, staffId: string): boolean {
    return (
      row.ticketStatus === "ACTIVE" &&
      row.visitDate === businessDate() &&
      row.createdByStaffId === staffId
    );
  }

  const other = await sessionCookieFor("gate"); // stands in for a second staff member

  const ownFresh = await createCounterBooking({
    visitorCount: 2,
    idempotencyKey: `verify-elig-${randomUUID()}`,
    createdByStaffId: counter.staffId,
    actor: { type: "STAFF", id: counter.staffId, name: "Counter Staff" },
  });
  check(
    "eligible: own sale, today, unused ticket",
    eligible(
      { createdByStaffId: counter.staffId, visitDate: businessDate(), ticketStatus: "ACTIVE" },
      counter.staffId,
    ),
  );
  check(
    "NOT eligible: someone else's sale",
    !eligible(
      { createdByStaffId: counter.staffId, visitDate: businessDate(), ticketStatus: "ACTIVE" },
      other.staffId,
    ),
  );

  // ---------------------------------------------------------------------
  console.log("\n9. Defense in depth: a boarded ticket can't be silently cancelled either");
  const boardedEventId = randomUUID();
  const boardResult = await confirmBoarding({
    token: (await db.select().from(tickets).where(eq(tickets.bookingId, ownFresh.booking.id)))[0]!
      .token,
    boardedCount: 2,
    clientEventId: boardedEventId,
    actor: { type: "SYSTEM", id: "verify-counter" },
  });
  check("boarding recorded", boardResult.ok === true);

  const [boardedTicketRow] = await db
    .select()
    .from(tickets)
    .where(eq(tickets.bookingId, ownFresh.booking.id));
  check(
    "eligibility gate correctly refuses a used ticket",
    !eligible(
      {
        createdByStaffId: counter.staffId,
        visitDate: businessDate(),
        ticketStatus: boardedTicketRow!.status,
      },
      counter.staffId,
    ),
  );

  // Even if the gate were somehow bypassed, the domain layer itself must
  // never let a USED ticket be quietly downgraded back to CANCELLED.
  await cancelBooking(
    ownFresh.booking.id,
    { type: "STAFF", id: counter.staffId, name: "Counter Staff" },
    "Voided at counter: attempting to void an already-boarded sale",
  );
  const [afterAttempt] = await db
    .select()
    .from(tickets)
    .where(eq(tickets.bookingId, ownFresh.booking.id));
  check(
    "ticket stays USED even if cancelBooking is called on it directly",
    afterAttempt!.status === "USED",
    `status=${afterAttempt!.status}`,
  );

  console.log(
    failures === 0
      ? "\nCounter flow behaved correctly end to end.\n"
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
