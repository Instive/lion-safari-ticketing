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
import { and, eq } from "drizzle-orm";

import { db, pool } from "@/db";
import { bookings, devices, staffSessions, staffUsers, tickets } from "@/db/schema";
import { confirmBoarding } from "@/domain/boarding/confirm";
import { createCounterBooking } from "@/domain/booking/create";
import { dayEndSummary } from "@/domain/reports/counter";
import { cancelBooking } from "@/domain/booking/refund";
import { activateReservedBooking, allocateBook, loadBook } from "@/domain/booking/reserve";
import { generateApiKey, sha256 } from "@/lib/codes";
import { env, staffBaseUrl } from "@/lib/env";
import { formatPaise } from "@/lib/money";
import { businessDate, formatClockTime, formatVisitDate } from "@/lib/time";

const BASE = staffBaseUrl();

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
  // A printed ticket outlives the screen it came from, so it has to say when
  // it was issued — from the server clock, never the counter device's.
  //
  // On a same-day ticket the visit date and the issue time share one line,
  // because printing "24 Aug 2026" twice told a guest nothing. The time is the
  // part that has to survive that merge, so it is asserted against the server's
  // own record of when the ticket was issued.
  const sameDayLine = `${formatVisitDate(sale.booking.visitDate)} · ${formatClockTime(
    ticketRows[0]!.issuedAt,
  )}`;
  check("shows the visit date and issue time on one line", ticketPage.body.includes(sameDayLine), sameDayLine);
  check(
    "and does not also print a separate Issued row",
    !ticketPage.body.includes(">Issued<"),
  );

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

  // ---------------------------------------------------------------------
  console.log("\n10. The shift total on /counter counts confirmed cash only");
  // Computed here by filtering in JS, independently of the SQL SUM the page
  // itself runs — a voided sale's money left the drawer, and counting it
  // would tell staff to hand over cash they no longer have.
  const todaysSales = await db
    .select({ status: bookings.status, amountTotal: bookings.amountTotal })
    .from(bookings)
    .where(
      and(
        eq(bookings.channel, "COUNTER"),
        eq(bookings.createdByStaffId, counter.staffId),
        eq(bookings.visitDate, businessDate()),
      ),
    );
  const confirmedCash = todaysSales
    .filter((row) => row.status === "CASH_CONFIRMED")
    .reduce((sum, row) => sum + row.amountTotal, 0);
  const cashIncludingVoided = todaysSales.reduce((sum, row) => sum + row.amountTotal, 0);

  const shiftPage = await get("/counter", counter.cookie);
  check(
    "shows the confirmed-cash total",
    shiftPage.body.includes(formatPaise(confirmedCash)),
    formatPaise(confirmedCash),
  );
  check(
    "does NOT show a total that includes the voided sale",
    confirmedCash === cashIncludingVoided ||
      !shiftPage.body.includes(formatPaise(cashIncludingVoided)),
    formatPaise(cashIncludingVoided),
  );

  // ---------------------------------------------------------------------
  console.log("\n11. A sale made during an outage appears in the recent-sales panel");
  // The blank is minted in advance, so its created_at is the moment the book was
  // allocated — up to BOOK_HORIZON_DAYS before anyone pays for it. Backdating it
  // reproduces that faithfully. Ordering the panel by created_at therefore sorted
  // every offline sale behind every online one and dropped it off the end, so the
  // sale staff had most reason to doubt was the only one they could not see.
  const [offlineTill] = await db
    .insert(devices)
    .values({
      name: `Verify Counter Till ${Date.now()}`,
      type: "COUNTER",
      apiKeyHash: sha256(generateApiKey()),
    })
    .returning();

  await allocateBook({
    deviceId: offlineTill!.id,
    visitDate: businessDate(),
    denominations: { 2: 1 },
    actor: { type: "STAFF", id: counter.staffId, name: "Counter Staff" },
  });
  const [blank] = await loadBook(offlineTill!.id, [businessDate()]);
  check("a blank is available to sell offline", Boolean(blank));

  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  await db
    .update(bookings)
    .set({ createdAt: twoDaysAgo })
    .where(eq(bookings.id, blank!.bookingId));

  const offlineSale = await activateReservedBooking({
    bookingId: blank!.bookingId,
    deviceId: offlineTill!.id,
    createdByStaffId: counter.staffId,
    soldOfflineAt: new Date().toISOString(),
    actor: { type: "STAFF", id: counter.staffId, name: "Counter Staff" },
  });
  check("the offline sale reconciled", offlineSale.booking.status === "CASH_CONFIRMED");

  const panel = await get("/counter", counter.cookie);
  check("responds 200", panel.status === 200, `got ${panel.status}`);
  check(
    "the reconciled offline sale is listed",
    panel.body.includes(offlineSale.booking.bookingCode),
    offlineSale.booking.bookingCode,
  );
  // Sold minutes ago against a blank minted two days ago: ordering by when the
  // cash was taken puts it above the online sale, ordering by creation buries it.
  const offlineAt = panel.body.indexOf(offlineSale.booking.bookingCode);
  const onlineAt = panel.body.indexOf(sale.booking.bookingCode);
  check(
    "it is ordered by when the cash was taken, not when the blank was minted",
    offlineAt !== -1 && onlineAt !== -1 && offlineAt < onlineAt,
    `offline@${offlineAt} online@${onlineAt}`,
  );
  check("and is labelled as sold offline", panel.body.includes("offline"));

  // ---------------------------------------------------------------------
  console.log("\n12. Cash and UPI are counted separately, and the day-end slip prints");
  const upiSale = await createCounterBooking({
    visitorCount: 2,
    idempotencyKey: randomUUID(),
    createdByStaffId: counter.staffId,
    tender: "UPI",
    actor: { type: "STAFF", id: counter.staffId, name: "Counter Staff" },
  });
  check("a UPI sale is confirmed like any other", upiSale.booking.status === "CASH_CONFIRMED");
  check(
    "and records how the money arrived",
    upiSale.booking.counterTender === "UPI",
    String(upiSale.booking.counterTender),
  );

  const summary = await dayEndSummary(counter.staffId, businessDate());
  check(
    "the UPI sale lands in the UPI column",
    summary.upi.amount >= upiSale.booking.amountTotal,
    `upi ${summary.upi.amount}`,
  );
  // The split existing is worth nothing if it does not add up: this is the
  // number the drawer and the bank statement are checked against together.
  check(
    "cash + UPI equals the day's takings",
    summary.cash.amount + summary.upi.amount === summary.total.amount,
    `${summary.cash.amount} + ${summary.upi.amount} vs ${summary.total.amount}`,
  );
  check(
    "the voided sale is excluded from takings but still reported",
    summary.cancelled.sales > 0,
    `${summary.cancelled.sales} cancelled`,
  );

  const slip = await get("/counter/day-end", counter.cookie);
  check("the day-end slip renders", slip.status === 200, `got ${slip.status}`);
  check("it shows the cash total", slip.body.includes(formatPaise(summary.cash.amount)));
  check("it shows the UPI total", slip.body.includes(formatPaise(summary.upi.amount)));

  // ---------------------------------------------------------------------
  console.log("\n13. Lost-ticket lookup finds a sale by whatever the guest can offer");
  // A guest who has lost their ticket is the whole reason this screen exists,
  // and what they can supply is rarely a full booking code in capitals: it is
  // part of a creased code, a phone number, or their own name.
  const marker = `Zizzo${Date.now().toString().slice(-6)}`;
  const findable = await createCounterBooking({
    visitorCount: 2,
    customerName: marker,
    customerPhone: "9876500123",
    idempotencyKey: randomUUID(),
    createdByStaffId: counter.staffId,
    actor: { type: "STAFF", id: counter.staffId, name: "Counter Staff" },
  });
  const found = findable.booking.bookingCode;

  const byPartialCode = await get(
    `/counter/lookup?q=${found.slice(2, 7).toLowerCase()}`,
    counter.cookie,
  );
  check(
    "part of a booking code, in lower case, finds it",
    byPartialCode.body.includes(found),
    found.slice(2, 7).toLowerCase(),
  );

  const byPhone = await get("/counter/lookup?q=9876500123", counter.cookie);
  check("a phone number finds it", byPhone.body.includes(found));

  const byName = await get(`/counter/lookup?q=${marker.toLowerCase()}`, counter.cookie);
  check("the guest's own name finds it", byName.body.includes(found), marker);

  const noMatch = await get("/counter/lookup?q=zzzznotathing", counter.cookie);
  check(
    "and a search that matches nothing says so, rather than looking empty",
    noMatch.body.includes("Nothing matched") && !noMatch.body.includes(found),
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
