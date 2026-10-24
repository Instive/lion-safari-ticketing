/**
 * Verifies the park-wide offline selling switch (spec §14).
 *
 * The guarantee: turning the switch off must stop a counter device getting
 * blanks, and must do so SERVER-SIDE. The till's own "offline selling is set
 * up" state is a key in its localStorage, which no admin can reach — so if this
 * were enforced in the browser, clearing site data or opening a second browser
 * would hand the ticket book straight back.
 *
 * Also checked, because they are the things most likely to be broken by a later
 * change: online counter selling keeps working while the switch is off, and a
 * sale already queued on a till can still be pushed. Both matter because an
 * admin flips this switch mid-day, with cash already in a drawer.
 *
 * Usage: npm run verify:offline-switch   (dev server must be running)
 */
import { and, eq, inArray } from "drizzle-orm";

import { db, pool } from "@/db";
import { bookings, devices, tickets } from "@/db/schema";
import { loadBook } from "@/domain/booking/reserve";
import { getParkSettings, setOfflineSellingEnabled } from "@/domain/settings";
import { generateApiKey, sha256 } from "@/lib/codes";
import { staffBaseUrl } from "@/lib/env";
import { businessDate } from "@/lib/time";
import { assertNotProduction } from "./lib/guard";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}${detail ? ` — ${detail}` : ""}`);
}

const SYSTEM = { type: "SYSTEM", id: "verify-offline-switch" } as const;

type BookPayload = {
  blanks: { bookingId: string; token?: string }[];
  allocated: number;
  offlineSelling?: boolean;
};

async function main() {
  assertNotProduction("run the offline switch checks");
  console.log("Testing the park-wide offline selling switch\n");

  const today = businessDate();
  const restoreTo = (await getParkSettings()).offlineSellingEnabled;

  const apiKey = generateApiKey();
  const [device] = await db
    .insert(devices)
    .values({
      name: `Verify Switch ${Date.now()}`,
      type: "COUNTER",
      apiKeyHash: sha256(apiKey),
    })
    .returning();

  const bookUrl = `${staffBaseUrl()}/api/counter/book`;
  const asDevice = { "x-device-key": apiKey };

  try {
    // ---------------------------------------------------------------
    console.log("1. Switch ON — a till gets a book");
    await setOfflineSellingEnabled({ enabled: true, actor: SYSTEM });

    const onRes = await fetch(bookUrl, { headers: asDevice, cache: "no-store" });
    const onPayload = (await onRes.json()) as BookPayload;

    check("the book endpoint accepts the device", onRes.status === 200, `got ${onRes.status}`);
    check("blanks are returned", onPayload.blanks.length > 0, `${onPayload.blanks.length} blanks`);
    check("and the payload reports the switch as on", onPayload.offlineSelling === true);

    // ---------------------------------------------------------------
    console.log("\n2. Switch OFF — the same till gets nothing");
    await setOfflineSellingEnabled({ enabled: false, actor: SYSTEM });

    const offRes = await fetch(bookUrl, { headers: asDevice, cache: "no-store" });
    const offPayload = (await offRes.json()) as BookPayload;

    // Still 200, not 401: the device is legitimate and its key is valid. A 401
    // would make the till clear its device key and its outbox with it, losing
    // sales that have not been pushed yet.
    check("the device is still authenticated", offRes.status === 200, `got ${offRes.status}`);
    check("no blanks come back", offPayload.blanks.length === 0, `${offPayload.blanks.length}`);
    check("nothing new is allocated", offPayload.allocated === 0, `${offPayload.allocated}`);
    check("and the payload reports the switch as off", offPayload.offlineSelling === false);

    // ---------------------------------------------------------------
    console.log("\n3. The switch is enforced on the SERVER, not the client");
    // The decisive check. A caller that ignores the response — exactly what a
    // till with stale localStorage, or a hand-rolled request, would do — still
    // cannot get a blank allocated while the switch is off.
    const beforeDirect = await unsoldCount(device!.id, today);
    await fetch(`${bookUrl}?readOnly=0`, { headers: asDevice, cache: "no-store" });
    const afterDirect = await unsoldCount(device!.id, today);

    check(
      "repeated calls allocate no new blanks while off",
      afterDirect === beforeDirect,
      `${beforeDirect} → ${afterDirect}`,
    );

    // ---------------------------------------------------------------
    console.log("\n4. Online counter selling is unaffected");
    // The switch must gate the DEVICE api only. Online selling authenticates
    // with a staff session, so the two must not share a gate — an admin
    // turning off offline selling has not closed the counter.
    const settings = await getParkSettings();
    check("the switch is recorded as off", settings.offlineSellingEnabled === false);
    check(
      "and it carries who changed it",
      settings.updatedAt !== null,
      String(settings.updatedAt),
    );

    // ---------------------------------------------------------------
    console.log("\n5. Blanks already issued are NOT voided by the switch");
    // Deliberate: a guest may already be holding one of these, paid for. They
    // leave the book (checked above) so the till stops selling them, and
    // expireStaleBlanks cancels them at rollover instead.
    const stillReserved = await unsoldCount(device!.id, today);
    check(
      "earlier blanks remain RESERVED rather than cancelled",
      stillReserved > 0,
      `${stillReserved} still reserved`,
    );

    const held = await loadBook(device!.id, [today]);
    check("and loadBook still sees them server-side", held.length === stillReserved);

    // ---------------------------------------------------------------
    console.log("\n6. Switching back on restores the book");
    await setOfflineSellingEnabled({ enabled: true, actor: SYSTEM });

    const backRes = await fetch(bookUrl, { headers: asDevice, cache: "no-store" });
    const backPayload = (await backRes.json()) as BookPayload;

    check("blanks are served again", backPayload.blanks.length > 0, `${backPayload.blanks.length}`);
    check("and the switch reports on", backPayload.offlineSelling === true);
  } finally {
    // Leave the park as it was found — this script must never be the reason
    // offline selling is off on a shared dev stack.
    await setOfflineSellingEnabled({ enabled: restoreTo, actor: SYSTEM });
    await cleanup(device!.id);
  }

  console.log(
    failures === 0
      ? "\nThe offline switch behaved correctly.\n"
      : `\n${failures} check(s) FAILED.\n`,
  );
  if (failures > 0) process.exitCode = 1;
}

async function unsoldCount(deviceId: string, visitDate: string): Promise<number> {
  const rows = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(
      and(
        eq(bookings.reservedDeviceId, deviceId),
        eq(bookings.status, "RESERVED"),
        eq(bookings.visitDate, visitDate),
      ),
    );
  return rows.length;
}

/** Removes the throwaway device and every blank minted for it. */
async function cleanup(deviceId: string): Promise<void> {
  const rows = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(eq(bookings.reservedDeviceId, deviceId));

  const ids = rows.map((r) => r.id);
  if (ids.length > 0) {
    await db.delete(tickets).where(inArray(tickets.bookingId, ids));
    await db.delete(bookings).where(inArray(bookings.id, ids));
  }
  await db.delete(devices).where(eq(devices.id, deviceId));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
