/**
 * Fills a dev database with a fortnight of plausible trading.
 *
 * Empty admin screens are the worst thing about a fresh environment: filters,
 * charts, the day-end slip and the CSV export all look fine when there is
 * nothing in them, so a change that breaks one is invisible until it reaches
 * the real counter. This produces enough spread — online and counter, cash and
 * UPI, concessions, cancellations, boardings — that those screens can actually
 * be judged.
 *
 * Everything goes through the DOMAIN functions rather than raw inserts. A
 * booking conjured straight into the table has no ticket, no audit row and
 * nothing in the scanner's change feed, so it would be data that the app's own
 * invariants say cannot exist — and screens built on those invariants would
 * misbehave on it in ways production never would.
 *
 * Usage: npm run db:seed:demo   (refuses unless APP_ENV is local or dev)
 */
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";

import { db, pool } from "@/db";
import {
  boardingEvents,
  bookings,
  devices,
  payments,
  rateCategories,
  staffUsers,
  tickets,
} from "@/db/schema";
import { confirmBoarding } from "@/domain/boarding/confirm";
import { createCounterBooking, createOnlineBooking } from "@/domain/booking/create";
import { cancelBooking } from "@/domain/booking/refund";
import { processPaymentEvent } from "@/domain/payment/process";
import { businessDate } from "@/lib/time";
import { assertNotProduction } from "./lib/guard";

/** How much history to fabricate. Two weeks covers every date filter in admin. */
const DAYS = 14;

const NAMES = [
  "Harpreet Kaur", "Rajesh Kumar", "Simran Gill", "Anil Sharma", "Priya Menon",
  "Gurdeep Singh", "Neha Bansal", "Vikram Rao", "Fatima Sheikh", "Arjun Patel",
  "Meera Joshi", "Sandeep Dhillon", "Kavita Iyer", "Imran Qureshi", "Ritu Verma",
];

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)]!;
}

function between(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

/** yyyy-MM-dd, `back` days before today in the park's timezone. */
function dayBack(back: number): string {
  const [y, m, d] = businessDate().split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! - back)).toISOString().slice(0, 10);
}

/** A plausible moment during opening hours (9am–5pm) on a given date. */
function tradingMoment(isoDate: string): Date {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!, between(3, 11), between(0, 59), between(0, 59)));
}

async function main() {
  assertNotProduction("seed demo trading data");

  const [counterStaff] = await db
    .select()
    .from(staffUsers)
    .where(eq(staffUsers.username, "counter"))
    .limit(1);

  if (!counterStaff) {
    console.error("No 'counter' staff user — run `npm run db:seed` first.");
    process.exit(1);
  }
  const actor = { type: "STAFF", id: counterStaff.id, name: counterStaff.name } as const;

  // ------------------------------------------------------------------ rates
  console.log("Concession rates…");
  for (const rate of [
    { name: "School group", perVisitorPaise: 5000 },
    { name: "Senior citizen", perVisitorPaise: 6000 },
  ]) {
    const [created] = await db
      .insert(rateCategories)
      .values({ ...rate, createdByStaffId: counterStaff.id })
      .onConflictDoNothing({ target: rateCategories.name })
      .returning();
    console.log(`  ${rate.name} — ${created ? "created" : "already there"}`);
  }
  const rates = await db.select().from(rateCategories).where(eq(rateCategories.active, true));

  // --------------------------------------------------------------- bookings
  console.log(`\nTrading, ${DAYS} days…`);
  const madeToday: string[] = [];
  let counterCount = 0;
  let onlineCount = 0;
  let pendingCount = 0;

  for (let back = DAYS - 1; back >= 0; back--) {
    const visitDate = dayBack(back);
    // Weekends are busier, the way the park actually is.
    const weekend = [0, 6].includes(new Date(`${visitDate}T12:00:00Z`).getUTCDay());
    const sales = weekend ? between(28, 40) : between(14, 24);

    for (let i = 0; i < sales; i++) {
      const visitorCount = pick([1, 2, 2, 3, 3, 4, 4, 5, 6, 8]);
      const name = pick(NAMES);
      const phone = `9${between(100000000, 999999999)}`;
      const at = tradingMoment(visitDate);

      const online = Math.random() < 0.35;
      let bookingId: string;
      let bookingCode: string;

      if (online) {
        const result = await createOnlineBooking({
          visitorCount,
          visitDate,
          customerName: name,
          customerPhone: phone,
          customerEmail: `${name.split(" ")[0]!.toLowerCase()}@example.com`,
          idempotencyKey: randomUUID(),
          actor: { type: "CUSTOMER", id: phone },
        });
        bookingId = result.booking.id;
        bookingCode = result.booking.bookingCode;

        // A tenth of online bookings never came back from checkout, which is
        // what the reconciliation sweep and the "awaiting payment" tile exist
        // for — leave them PENDING so those screens have something to show.
        if (Math.random() < 0.1) {
          pendingCount++;
        } else {
          await payForOnlineBooking(result.booking.id, result.booking.amountTotal, bookingCode);
          onlineCount++;
        }
      } else {
        const roll = Math.random();
        const rate =
          roll < 0.8 || rates.length === 0
            ? ({ kind: "STANDARD" } as const)
            : roll < 0.95
              ? ({ kind: "CATEGORY", categoryId: pick(rates).id } as const)
              : ({ kind: "CUSTOM", perVisitorPaise: 4000, note: "Park guest" } as const);

        const result = await createCounterBooking({
          visitorCount,
          visitDate,
          customerName: Math.random() < 0.4 ? name : null,
          customerPhone: Math.random() < 0.4 ? phone : null,
          idempotencyKey: randomUUID(),
          createdByStaffId: counterStaff.id,
          rate,
          tender: Math.random() < 0.75 ? "CASH" : "UPI",
          actor,
        });
        bookingId = result.booking.id;
        bookingCode = result.booking.bookingCode;
        counterCount++;
      }

      // The row was created just now; the sale it represents happened days ago.
      await db
        .update(bookings)
        .set({ createdAt: at, updatedAt: at })
        .where(eq(bookings.id, bookingId));
      await db.update(tickets).set({ issuedAt: at }).where(eq(tickets.bookingId, bookingId));

      if (back === 0) madeToday.push(bookingId);

      // A few mis-keyed counts, voided the way staff would.
      if (Math.random() < 0.04) {
        await cancelBooking(bookingId, actor, "Demo data: mis-keyed visitor count");
      }
    }

    process.stdout.write(`  ${visitDate}  ${String(sales).padStart(2)} sales\n`);
  }

  // -------------------------------------------------------------- boardings
  console.log("\nBoardings…");
  // Today's tickets go through confirmBoarding, the real gate path.
  let boarded = 0;
  for (const bookingId of madeToday) {
    if (Math.random() > 0.55) continue;
    const [ticket] = await db.select().from(tickets).where(eq(tickets.bookingId, bookingId)).limit(1);
    if (!ticket || ticket.status !== "ACTIVE") continue;

    const result = await confirmBoarding({
      ticketId: ticket.id,
      boardedCount: ticket.visitorCount,
      clientEventId: randomUUID(),
      staffId: counterStaff.id,
      actor,
    });
    if (result.ok) boarded++;
  }
  console.log(`  ${boarded} boarded today through the gate path`);

  /*
   * Earlier days are written directly, and that is a deliberate exception.
   *
   * `confirmBoarding` refuses a ticket whose visit date is not today — correctly,
   * that is the WRONG_DATE rule the gate depends on. There is no legitimate way
   * to board a ticket from last Tuesday, so backfilling history means writing
   * the rows the gate would have written. Nothing here weakens that rule; it
   * stays intact for every real scan.
   */
  const past = await db
    .select({ id: tickets.id, visitorCount: tickets.visitorCount, visitDate: tickets.visitDate })
    .from(tickets)
    .where(sql`${tickets.status} = 'ACTIVE' and ${tickets.visitDate} < ${businessDate()}`);

  const [gate] = await db.select().from(devices).where(eq(devices.type, "SCANNER")).limit(1);
  let backfilled = 0;

  for (const ticket of past) {
    if (Math.random() > 0.7) continue;
    const at = tradingMoment(ticket.visitDate);

    await db.insert(boardingEvents).values({
      ticketId: ticket.id,
      boardedCount: ticket.visitorCount,
      staffId: counterStaff.id,
      deviceId: gate?.id ?? null,
      clientEventId: randomUUID(),
      boardedAt: at,
      deviceReportedAt: at,
      createdOffline: Math.random() < 0.15,
    });
    await db
      .update(tickets)
      .set({ status: "USED", usedAt: at, updatedAt: at })
      .where(eq(tickets.id, ticket.id));
    backfilled++;
  }
  console.log(`  ${backfilled} backfilled on earlier days`);

  console.log(
    `\nDone. ${counterCount} counter sales, ${onlineCount} paid online, ` +
      `${pendingCount} still awaiting payment.\n`,
  );
}

/**
 * Takes an online booking from PENDING to PAID through the only path that can
 * do it: a payment event applied by `processPaymentEvent`.
 *
 * The `payments` row is inserted here rather than by `startOnlinePayment`
 * because that function's next act is a live call to Cashfree, which a seeder
 * has no business making. The row written is the same one it writes.
 */
async function payForOnlineBooking(
  bookingId: string,
  amountPaise: number,
  bookingCode: string,
): Promise<void> {
  const orderId = `LS-${bookingCode}`;

  await db
    .insert(payments)
    .values({
      bookingId,
      provider: "cashfree",
      providerOrderId: orderId,
      status: "PENDING",
      amount: amountPaise,
      currency: "INR",
    })
    .onConflictDoNothing({ target: payments.providerOrderId });

  const result = await processPaymentEvent("cashfree", {
    providerEventId: `demo-${orderId}`,
    eventType: "PAYMENT_SUCCESS_WEBHOOK",
    kind: "PAYMENT_SUCCESS",
    orderId,
    providerPaymentId: `demo-pay-${bookingCode}`,
    amountPaise,
    currency: "INR",
    rawPayload: { demo: true, orderId },
  });

  if (result.status !== "PROCESSED") {
    console.warn(`  online booking ${bookingCode} did not confirm: ${result.status}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
