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
import {
  bookDiscrepancies,
  bookStock,
  offlineSalesFor,
} from "@/domain/reports/ticket-books";
import { DomainError } from "@/domain/errors";
import { generateApiKey, sha256 } from "@/lib/codes";
import { env, staffBaseUrl } from "@/lib/env";
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

  // -----------------------------------------------------------------------
  console.log("\n9. Oversight reports what the trade-off requires");
  const stock = await bookStock(today);
  const mine = stock.find((row) => row.deviceId === device!.id && row.visitDate === today);
  check("stock is reported for this till", Boolean(mine), `${stock.length} row(s)`);
  check(
    "sold and unsold are counted separately",
    mine !== undefined && mine.sold >= 1 && mine.unsold >= 1,
    mine ? `${mine.unsold} unsold, ${mine.sold} sold` : "",
  );

  const offline = await offlineSalesFor(today, today);
  check(
    "the offline sale is reported as offline trade",
    offline.count >= 1 && offline.collectedPaise >= 5 * env.TICKET_PRICE_PAISE,
    `${offline.count} sale(s), ${offline.collectedPaise} paise`,
  );

  // A blank boarded but never sold is the fraud/loss signal the whole design
  // leans on, so it is worth proving the query actually finds one.
  const orphan = book.find((b) => b.visitorCount === 2 && b.bookingId !== stealTarget.bookingId)!;
  const [orphanTicket] = await db
    .select()
    .from(tickets)
    .where(eq(tickets.bookingId, orphan.bookingId))
    .limit(1);
  await confirmBoarding({
    token: orphanTicket!.token,
    boardedCount: 2,
    clientEventId: randomUUID(),
    actor: SYSTEM,
  });

  const discrepancies = await bookDiscrepancies(today, today);
  check(
    "a blank boarded with no sale is flagged",
    discrepancies.some((d) => d.bookingId === orphan.bookingId),
    `${discrepancies.length} discrepancy(ies)`,
  );
  check(
    "a blank that WAS sold is not flagged",
    !discrepancies.some((d) => d.bookingId === sold.bookingId),
  );

  // -----------------------------------------------------------------------
  console.log("\n10. Special prices stay bounded (counter concessions)");
  const cheap = book.find(
    (b) =>
      b.visitorCount === 2 &&
      b.bookingId !== stealTarget.bookingId &&
      b.bookingId !== orphan.bookingId,
  )!;
  const discounted = await activateReservedBooking({
    bookingId: cheap.bookingId,
    deviceId: device!.id,
    rate: { kind: "CUSTOM", perVisitorPaise: 5000 },
    tender: "UPI",
    actor: SYSTEM,
  });
  check(
    "a special price is applied from the server's own quote",
    discounted.booking.amountTotal === 2 * 5000,
    `${discounted.booking.amountTotal}`,
  );
  check("and recorded per visitor", discounted.booking.perVisitorPaise === 5000);
  // A till taking UPI during an outage must not have it reconciled as cash —
  // the drawer would then be expected to hold money that never entered it.
  check(
    "the tender chosen offline survives reconciliation",
    discounted.booking.counterTender === "UPI",
    String(discounted.booking.counterTender),
  );
  check(
    "and a blank sold without one defaults to cash",
    result.booking.counterTender === "CASH",
    String(result.booking.counterTender),
  );

  // Any blank this run has not already consumed. Picked by exclusion rather
  // than by size so this check can never quietly skip itself.
  const spent = [sold.bookingId, stealTarget.bookingId, orphan.bookingId, cheap.bookingId];
  const another = book.find((b) => !spent.includes(b.bookingId));
  check("a spare blank is available for the overcharge check", Boolean(another));

  let overcharged = false;
  if (another) {
    try {
      await activateReservedBooking({
        bookingId: another.bookingId,
        deviceId: device!.id,
        rate: { kind: "CUSTOM", perVisitorPaise: env.TICKET_PRICE_PAISE + 1 },
        actor: SYSTEM,
      });
    } catch (err) {
      overcharged = err instanceof DomainError && err.code === "RATE_ABOVE_STANDARD";
    }
  }
  check("a price above the standard fare is refused", overcharged);

  const [untouched] = another
    ? await db.select().from(bookings).where(eq(bookings.id, another.bookingId)).limit(1)
    : [];
  check(
    "and the refused blank is still unsold",
    untouched?.status === "RESERVED",
    untouched?.status,
  );

  // -----------------------------------------------------------------------
  console.log("\n11. The book API answers a counter till, and only a counter till");
  // A till enrols itself in one tap now (enrolThisTillAction), which mints
  // exactly this kind of key. What that key may reach is the boundary worth
  // holding: the book endpoint hands back RAW tokens, because the counter has
  // to print them. A gate device must never be able to pull that list — it is
  // issued only token hashes for precisely this reason (spec §5).
  const scannerKey = generateApiKey();
  await db.insert(devices).values({
    name: `Verify Gate ${Date.now()}`,
    type: "SCANNER",
    apiKeyHash: sha256(scannerKey),
  });

  const asCounter = await fetch(`${staffBaseUrl()}/api/counter/book`, {
    headers: { "x-device-key": apiKey },
  });
  check("a counter key is accepted", asCounter.status === 200, `got ${asCounter.status}`);

  const payload = (await asCounter.json()) as { blanks: { token?: string }[] };
  check("and the blanks come back with tokens to print", Boolean(payload.blanks[0]?.token));

  const asScanner = await fetch(`${staffBaseUrl()}/api/counter/book`, {
    headers: { "x-device-key": scannerKey },
  });
  check("a gate key is refused", asScanner.status === 401, `got ${asScanner.status}`);

  const noKey = await fetch(`${staffBaseUrl()}/api/counter/book`);
  check("and an unauthenticated caller is refused", noKey.status === 401, `got ${noKey.status}`);

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
