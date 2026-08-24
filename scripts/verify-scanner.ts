/**
 * Exercises the gate scanner APIs against a running dev server — the offline
 * and duplicate scenarios from spec §14.
 *
 * Usage: npm run verify:scanner   (dev server must be running)
 */
import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";

import { db, pool } from "@/db";
import { boardingEvents, devices, tickets } from "@/db/schema";
import { createCounterBooking } from "@/domain/booking/create";
import { generateApiKey, sha256 } from "@/lib/codes";
import { staffBaseUrl } from "@/lib/env";
import { judge } from "@/lib/scanner/judge";
import type { CachedTicket } from "@/lib/scanner/db";
import { businessDate } from "@/lib/time";
import { assertNotProduction } from "./lib/guard";

const BASE = staffBaseUrl();

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}${detail ? ` — ${detail}` : ""}`);
}

type SyncPayload = {
  serverTime: string;
  version: number;
  fullSync: boolean;
  visitDate: string;
  staleThresholdSeconds: number;
  tickets: {
    ticketId: string;
    tokenHash: string;
    bookingCode: string;
    status: string;
    visitorCount: number;
    visitDate: string;
    usedAt: string | null;
  }[];
};

async function sync(key: string, since: number): Promise<{ status: number; body: SyncPayload }> {
  const res = await fetch(`${BASE}/api/scanner/sync?since=${since}`, {
    headers: { "x-device-key": key },
  });
  return { status: res.status, body: res.status === 200 ? await res.json() : ({} as SyncPayload) };
}

async function pushEvents(
  key: string,
  events: { clientEventId: string; ticketId: string; boardedCount: number; createdOffline?: boolean }[],
) {
  const res = await fetch(`${BASE}/api/scanner/events`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-device-key": key },
    body: JSON.stringify({ events: events.map((e) => ({ createdOffline: false, ...e })) }),
  });
  return {
    status: res.status,
    body: (await res.json()) as {
      results: { clientEventId: string; accepted: boolean; duplicate: boolean; reason?: string }[];
    },
  };
}

async function main() {
  assertNotProduction("run the scanner checks");
  console.log(`Testing scanner APIs at ${BASE}\n`);

  // A dedicated device for this run, so the real gate device is untouched.
  const apiKey = generateApiKey();
  const [device] = await db
    .insert(devices)
    .values({
      name: `Verification Scanner ${randomUUID().slice(0, 8)}`,
      type: "SCANNER",
      apiKeyHash: sha256(apiKey),
    })
    .returning();

  // ---------------------------------------------------------------------
  console.log("1. An unknown device key is refused");
  const bad = await sync("not-a-real-device-key", 0);
  check("responds 401", bad.status === 401, `got ${bad.status}`);

  // ---------------------------------------------------------------------
  console.log("\n2. Full sync returns today's manifest with hashed tokens only");
  const booking = await createCounterBooking({
    visitorCount: 4,
    idempotencyKey: `verify-scan-${randomUUID()}`,
    customerName: "Scanner Test",
    actor: { type: "SYSTEM", id: "verify-scanner" },
  });

  const full = await sync(apiKey, 0);
  check("responds 200", full.status === 200, `got ${full.status}`);
  check("is a full sync", full.body.fullSync === true);
  check("returns a server time", Boolean(full.body.serverTime));

  const entry = full.body.tickets.find((t) => t.ticketId === booking.ticket!.id);
  check("new ticket present in manifest", Boolean(entry));

  const expectedHash = createHash("sha256").update(booking.ticket!.token).digest("hex");
  check("token hash matches sha256 of the token", entry?.tokenHash === expectedHash);

  const payloadText = JSON.stringify(full.body);
  check(
    "raw ticket token is NEVER sent to the device",
    !payloadText.includes(booking.ticket!.token),
  );
  check(
    "customer name is NEVER sent to the device",
    !payloadText.includes("Scanner Test"),
  );

  const versionAfterFull = full.body.version;

  // ---------------------------------------------------------------------
  console.log("\n3. Incremental sync picks up a booking made after the last sync");
  const later = await createCounterBooking({
    visitorCount: 2,
    idempotencyKey: `verify-scan-${randomUUID()}`,
    actor: { type: "SYSTEM", id: "verify-scanner" },
  });

  const incremental = await sync(apiKey, versionAfterFull);
  check("responds 200", incremental.status === 200, `got ${incremental.status}`);
  check("is not a full sync", incremental.body.fullSync === false);
  check(
    "contains the newly created ticket",
    incremental.body.tickets.some((t) => t.ticketId === later.ticket!.id),
  );
  check("version advanced", incremental.body.version > versionAfterFull);

  // ---------------------------------------------------------------------
  console.log("\n4. A boarding event is recorded and consumes the ticket");
  const eventId = randomUUID();
  const push1 = await pushEvents(apiKey, [
    { clientEventId: eventId, ticketId: booking.ticket!.id, boardedCount: 4 },
  ]);
  check("responds 200", push1.status === 200, `got ${push1.status}`);
  check("event accepted", push1.body.results[0]?.accepted === true);
  check("not flagged duplicate", push1.body.results[0]?.duplicate === false);

  const [afterBoarding] = await db
    .select()
    .from(tickets)
    .where(eq(tickets.id, booking.ticket!.id));
  check("ticket is USED", afterBoarding!.status === "USED");

  // ---------------------------------------------------------------------
  console.log("\n5. Replaying the queued event (reconnect / restart) does not double-board");
  const push2 = await pushEvents(apiKey, [
    { clientEventId: eventId, ticketId: booking.ticket!.id, boardedCount: 4, createdOffline: true },
  ]);
  check("accepted again", push2.body.results[0]?.accepted === true);
  check("reported as duplicate", push2.body.results[0]?.duplicate === true);

  const events = await db
    .select()
    .from(boardingEvents)
    .where(eq(boardingEvents.ticketId, booking.ticket!.id));
  check("exactly one boarding event exists", events.length === 1, `found ${events.length}`);

  // ---------------------------------------------------------------------
  console.log("\n6. A fresh scan of an already-used ticket is refused");
  const push3 = await pushEvents(apiKey, [
    { clientEventId: randomUUID(), ticketId: booking.ticket!.id, boardedCount: 4 },
  ]);
  check("not accepted", push3.body.results[0]?.accepted === false);
  check(
    "reason is ALREADY_USED",
    push3.body.results[0]?.reason === "ALREADY_USED",
    String(push3.body.results[0]?.reason),
  );

  const eventsAfter = await db
    .select()
    .from(boardingEvents)
    .where(eq(boardingEvents.ticketId, booking.ticket!.id));
  check("still exactly one boarding event", eventsAfter.length === 1, `found ${eventsAfter.length}`);

  // ---------------------------------------------------------------------
  console.log("\n7. Partial boarding is refused (all-or-nothing)");
  const push4 = await pushEvents(apiKey, [
    { clientEventId: randomUUID(), ticketId: later.ticket!.id, boardedCount: 1 },
  ]);
  check("not accepted", push4.body.results[0]?.accepted === false);
  check(
    "reason is COUNT_MISMATCH",
    push4.body.results[0]?.reason === "COUNT_MISMATCH",
    String(push4.body.results[0]?.reason),
  );

  // ---------------------------------------------------------------------
  console.log("\n8. A deactivated device is locked out immediately");
  await db.update(devices).set({ active: false }).where(eq(devices.id, device!.id));
  const afterDeactivation = await sync(apiKey, 0);
  check("sync responds 401", afterDeactivation.status === 401, `got ${afterDeactivation.status}`);

  const pushAfter = await fetch(`${BASE}/api/scanner/events`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-device-key": apiKey },
    body: JSON.stringify({
      events: [{ clientEventId: randomUUID(), ticketId: later.ticket!.id, boardedCount: 2 }],
    }),
  });
  check("event push responds 401", pushAfter.status === 401, `got ${pushAfter.status}`);

  checkJudge();

  console.log(
    failures === 0
      ? "\nAll scanner scenarios behaved correctly.\n"
      : `\n${failures} check(s) FAILED.\n`,
  );
  if (failures > 0) process.exitCode = 1;
}

/**
 * The gate's admit/turn-away decision, checked directly.
 *
 * This exists because a real failure shipped here: `judge` derived "today" from
 * `new Date().toISOString()`, which is always UTC, so every valid ticket was
 * rejected as WRONG DATE between midnight and 05:30 IST. The park day must come
 * from the server's sync payload and nothing else — so these run with the
 * process forced onto a timezone whose UTC date differs from the park's.
 */
function checkJudge() {
  console.log("\n9. The gate verdict never depends on the device clock");

  const parkDay = businessDate();
  const ticket = (visitDate: string, status: CachedTicket["status"]): CachedTicket =>
    ({ ticketId: "t", tokenHash: "h", status, visitorCount: 2, visitDate, usedAt: null }) as CachedTicket;

  const originalTz = process.env.TZ;
  // Pacific/Kiritimati is UTC+14 and Pacific/Midway is UTC-11: on any given
  // instant these two sit on different calendar dates, so if the verdict moved
  // with the device timezone at all, one of them would disagree.
  for (const tz of ["Pacific/Kiritimati", "Pacific/Midway", "UTC"]) {
    process.env.TZ = tz;
    const verdict = judge(ticket(parkDay, "ACTIVE"), parkDay);
    check(`today's ticket is VALID with device TZ=${tz}`, verdict.kind === "VALID", verdict.kind);
  }
  process.env.TZ = originalTz;

  const stale = judge(ticket("2020-01-01", "ACTIVE"), parkDay);
  check(
    "a ticket for another day is still rejected",
    stale.kind === "REJECTED" && stale.message === "WRONG DATE",
    stale.kind === "REJECTED" ? stale.message : stale.kind,
  );

  const unsynced = judge(ticket(parkDay, "ACTIVE"), null);
  check(
    "never-synced scanner says SYNC NEEDED, not WRONG DATE",
    unsynced.kind === "REJECTED" && unsynced.message === "SYNC NEEDED",
    unsynced.kind === "REJECTED" ? unsynced.message : unsynced.kind,
  );

  const used = judge(ticket(parkDay, "USED"), parkDay);
  check(
    "an already-used ticket is rejected before the date is considered",
    used.kind === "REJECTED" && used.message === "ALREADY USED",
    used.kind === "REJECTED" ? used.message : used.kind,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
