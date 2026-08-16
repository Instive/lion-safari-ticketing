/**
 * Hands-on verification of the invariants the whole system rests on.
 * Run against a dev database:  npm run verify:domain
 *
 * This is a walkthrough script, not a test suite — it prints what it did so a
 * human can see the guarantees hold.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";

import { db, pool } from "@/db";
import { boardingEvents, bookings, tickets } from "@/db/schema";
import { confirmBoarding, validateToken } from "@/domain/boarding/confirm";
import { createCounterBooking } from "@/domain/booking/create";
import type { Actor } from "@/domain/audit";

const actor: Actor = { type: "SYSTEM", id: "verify-script" };

let failures = 0;
function check(label: string, condition: boolean, detail = "") {
  const mark = condition ? "PASS" : "FAIL";
  if (!condition) failures++;
  console.log(`  [${mark}] ${label}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  console.log("\n1. Double-submitted counter booking creates ONE booking and ONE ticket");
  const key = `verify-${randomUUID()}`;
  const first = await createCounterBooking({
    visitorCount: 5,
    idempotencyKey: key,
    customerName: "Verification Guest",
    actor,
  });
  const second = await createCounterBooking({
    visitorCount: 5,
    idempotencyKey: key,
    customerName: "Verification Guest",
    actor,
  });

  check("same booking returned", first.booking.id === second.booking.id, first.booking.bookingCode);
  check("second call reported as not-created", second.created === false);
  check("ticket issued at counter", first.ticket !== null);
  check("same ticket returned", first.ticket?.id === second.ticket?.id);

  const ticketRows = await db.select().from(tickets).where(eq(tickets.bookingId, first.booking.id));
  check("exactly one ticket row exists", ticketRows.length === 1, `found ${ticketRows.length}`);

  const token = first.ticket!.token;
  check("token is high-entropy (>=32 chars)", token.length >= 32, `${token.length} chars`);

  console.log("\n2. Ticket validates as boardable before use");
  const before = await validateToken(token);
  check("valid before boarding", before.valid === true);

  console.log("\n3. Replayed boarding event (same client_event_id) does not double-board");
  const clientEventId = randomUUID();
  const board1 = await confirmBoarding({ token, boardedCount: 5, clientEventId, actor });
  const board2 = await confirmBoarding({ token, boardedCount: 5, clientEventId, actor });

  check("first boarding succeeded", board1.ok === true);
  check("replay reported as duplicate", board2.ok === true && board2.duplicate === true);

  const events = await db
    .select()
    .from(boardingEvents)
    .where(eq(boardingEvents.ticketId, first.ticket!.id));
  check("exactly one boarding event recorded", events.length === 1, `found ${events.length}`);

  console.log("\n4. A used ticket is rejected on a fresh scan");
  const rescan = await confirmBoarding({
    token,
    boardedCount: 5,
    clientEventId: randomUUID(),
    actor,
  });
  check(
    "rejected as ALREADY_USED",
    rescan.ok === false && rescan.reason === "ALREADY_USED",
    rescan.ok === false ? rescan.message : "unexpectedly accepted",
  );

  const eventsAfter = await db
    .select()
    .from(boardingEvents)
    .where(eq(boardingEvents.ticketId, first.ticket!.id));
  check("still exactly one boarding event", eventsAfter.length === 1, `found ${eventsAfter.length}`);

  console.log("\n5. All-or-nothing: a partial count is refused");
  const partialKey = `verify-${randomUUID()}`;
  const partial = await createCounterBooking({
    visitorCount: 4,
    idempotencyKey: partialKey,
    actor,
  });
  const short = await confirmBoarding({
    token: partial.ticket!.token,
    boardedCount: 3,
    clientEventId: randomUUID(),
    actor,
  });
  check(
    "boarding 3 of 4 refused",
    short.ok === false && short.reason === "COUNT_MISMATCH",
    short.ok === false ? short.message : "unexpectedly accepted",
  );
  const stillActive = await validateToken(partial.ticket!.token);
  check("ticket remains usable after refusal", stillActive.valid === true);

  console.log("\n6. Unknown token is rejected");
  const unknown = await validateToken("this-token-does-not-exist");
  check("unknown token not valid", unknown.valid === false);

  console.log("\n7. Pricing is server-computed");
  const [row] = await db.select().from(bookings).where(eq(bookings.id, first.booking.id));
  check(
    "counter booking carries no convenience fee",
    row!.convenienceFee === 0,
    `fee=${row!.convenienceFee}`,
  );
  check(
    "amount = visitors × price",
    row!.amountTotal === 5 * Number(process.env.TICKET_PRICE_PAISE ?? 50000),
    `amount=${row!.amountTotal}`,
  );

  console.log(
    failures === 0
      ? "\nAll domain invariants held.\n"
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
