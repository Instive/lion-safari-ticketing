/**
 * Verifies the offline counter ticket books end to end against a running dev
 * server.
 *
 * The guarantee this whole design rests on is checked in scenario 2: a blank
 * pre-issued to a counter device MUST appear in the gate scanner's manifest.
 * If it ever stops doing so, the park would sell tickets during an outage that
 * its own gate then refuses — the exact failure the design exists to prevent.
 *
 * Usage: npm run verify:offline-counter   (dev server must be running)
 */
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";

import { db, pool } from "@/db";
import { bookings, devices, tickets } from "@/db/schema";
import { confirmBoarding } from "@/domain/boarding/confirm";
import {
  activateReservedBooking,
  allocateBook,
  expireStaleBlanks,
  loadBook,
} from "@/domain/booking/reserve";
import { buildSync } from "@/domain/scanner/sync";
import { DomainError } from "@/domain/errors";
import { generateApiKey, sha256 } from "@/lib/codes";
import { env } from "@/lib/env";
import { businessDate } from "@/lib/time";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}${detail ? ` — ${detail}` : ""}`);
}

const SYSTEM = { type: "SYSTEM", id: "verify-offline-counter" } as const;

async function main() {
  console.log("Testing offline counter ticket books\n");

  const today = businessDate();

  // A throwaway counter device, so this never disturbs a real one's book.
  const apiKey = generateApiKey();
  const [device] = await db
    .insert(devices)
    .values({
      name: `Verify Counter ${Date.now()}`,
      type: "COUNTER",
      apiKeyHash: sha256(apiKey),
    })
    .returning();

  // -----------------------------------------------------------------------
  console.log("1. Allocating a book creates unsold blanks with live tickets");
  const denominations = { 2: 3, 5: 2 };
  const first = await allocateBook({
    deviceId: device!.id,
    visitDate: today,
    denominations,
    actor: SYSTEM,
  });
  check("created the requested number of blanks", first.created === 5, `created ${first.created}`);

  const book = await loadBook(device!.id, [today]);
  check("the book reads back the same count", book.length === 5, `${book.length} blank(s)`);
  check(
    "denominations match what was asked for",
    book.filter((b) => b.visitorCount === 2).length === 3 &&
      book.filter((b) => b.visitorCount === 5).length === 2,
  );
  check(
    "every blank carries a token the counter can print",
    book.every((b) => typeof b.token === "string" && b.token.length > 20),
  );

  const blankIds = book.map((b) => b.bookingId);
  const blankRows = await db.select().from(bookings).where(inArray(bookings.id, blankIds));
  check(
    "blanks are RESERVED and cost nothing until sold",
    blankRows.every((r) => r.status === "RESERVED" && r.amountTotal === 0),
  );

  // -----------------------------------------------------------------------
  console.log("\n2. A blank is in the gate manifest, so it scans offline");
  const manifest = await buildSync(0, env.SYNC_STALE_THRESHOLD_SECONDS);
  const sample = book[0]!;
  const [sampleTicket] = await db
    .select()
    .from(tickets)
    .where(eq(tickets.bookingId, sample.bookingId))
    .limit(1);

  const inManifest = manifest.tickets.find((t) => t.ticketId === sampleTicket!.id);
  check("the blank's ticket is in today's manifest", Boolean(inManifest), sample.bookingCode);
  check(
    "the manifest carries the printed visitor count",
    inManifest?.visitorCount === sample.visitorCount,
    `${inManifest?.visitorCount} vs ${sample.visitorCount}`,
  );
  check("the manifest shows it as ACTIVE", inManifest?.status === "ACTIVE");
  check(
    "the manifest still exposes only a hash, never the token",
    inManifest !== undefined &&
      !JSON.stringify(inManifest).includes(sample.token) &&
      inManifest.tokenHash === sha256(sample.token),
  );

  // -----------------------------------------------------------------------
  console.log("\n3. Topping up only creates what is missing");
  const second = await allocateBook({
    deviceId: device!.id,
    visitDate: today,
    denominations,
    actor: SYSTEM,
  });
  check("a fully stocked book allocates nothing", second.created === 0, `created ${second.created}`);

  // -----------------------------------------------------------------------
  console.log("\n4. Selling a blank prices it on the SERVER, not from the device");
  const sold = book.find((b) => b.visitorCount === 5)!;
  const result = await activateReservedBooking({
    bookingId: sold.bookingId,
    deviceId: device!.id,
    customerName: "Offline Guest",
    soldOfflineAt: new Date().toISOString(),
    actor: SYSTEM,
  });

  check("the sale is confirmed", result.booking.status === "CASH_CONFIRMED");
  check("it is reported as newly activated", result.activated);
  check(
    "amount = printed visitor count × standard fare",
    result.booking.amountTotal === 5 * env.TICKET_PRICE_PAISE,
    `${result.booking.amountTotal} vs ${5 * env.TICKET_PRICE_PAISE}`,
  );
  check(
    "the visitor count is the one printed on the blank, unchanged",
    result.booking.visitorCount === 5,
  );
  check("the offline sale time is recorded", result.booking.soldOfflineAt !== null);

  // -----------------------------------------------------------------------
  console.log("\n5. Re-pushing the same queued sale changes nothing");
  const replay = await activateReservedBooking({
    bookingId: sold.bookingId,
    deviceId: device!.id,
    actor: SYSTEM,
  });
  check("reported as already reconciled", replay.activated === false);
  check("same booking returned", replay.booking.id === result.booking.id);
  check(
    "the amount was not charged twice",
    replay.booking.amountTotal === 5 * env.TICKET_PRICE_PAISE,
    `${replay.booking.amountTotal}`,
  );

  // -----------------------------------------------------------------------
  console.log("\n6. Another device cannot claim this device's blanks");
  const otherKey = generateApiKey();
  const [otherDevice] = await db
    .insert(devices)
    .values({
      name: `Verify Counter Other ${Date.now()}`,
      type: "COUNTER",
      apiKeyHash: sha256(otherKey),
    })
    .returning();

  const stealTarget = book.find((b) => b.visitorCount === 2)!;
  let refused = false;
  try {
    await activateReservedBooking({
      bookingId: stealTarget.bookingId,
      deviceId: otherDevice!.id,
      actor: SYSTEM,
    });
  } catch (err) {
    refused = err instanceof DomainError && err.code === "BLANK_WRONG_DEVICE";
  }
  check("a blank belonging to another counter is refused", refused);

  // -----------------------------------------------------------------------
  console.log("\n7. A blank sold offline can still be boarded and reconciled");
  const [soldTicket] = await db
    .select()
    .from(tickets)
    .where(eq(tickets.bookingId, sold.bookingId))
    .limit(1);

  const boarding = await confirmBoarding({
    token: soldTicket!.token,
    boardedCount: 5,
    clientEventId: randomUUID(),
    actor: SYSTEM,
  });
  check("the gate accepts it", boarding.ok === true);

  // -----------------------------------------------------------------------
  console.log("\n8. Unsold blanks expire at rollover and leave the manifest");
  const staleDate = "2020-01-01";
  await allocateBook({
    deviceId: device!.id,
    visitDate: staleDate,
    denominations: { 2: 2 },
    actor: SYSTEM,
  });
  const expired = await expireStaleBlanks(SYSTEM, today);
  check("stale blanks were expired", expired >= 2, `${expired} expired`);

  const leftover = await db
    .select()
    .from(bookings)
    .where(and(eq(bookings.reservedDeviceId, device!.id), eq(bookings.visitDate, staleDate)));
  check(
    "none of them are RESERVED any more",
    leftover.every((r) => r.status !== "RESERVED"),
  );

  const leftoverTickets = await db
    .select()
    .from(tickets)
    .where(
      inArray(
        tickets.bookingId,
        leftover.map((r) => r.id),
      ),
    );
  check(
    "and their tickets are no longer admissible",
    leftoverTickets.every((t) => t.status !== "ACTIVE"),
  );

  console.log(
    failures === 0
      ? "\nOffline counter books behaved correctly end to end.\n"
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
