import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { bookings, staffUsers } from "@/db/schema";
import { counterLookupMatches } from "@/domain/reports/counter";
import { filtersToQuery, parseFilters, whereFor } from "@/domain/reports/bookings";
import { businessDate } from "@/lib/time";
import { assertNotProduction } from "./lib/guard";

async function main() {
  assertNotProduction("verify counter visibility and sales filters (rolled back)");
  const rollback = new Error("test rollback");
  try {
    await db.transaction(async tx => {
      const marker = randomUUID();
      const today = businessDate();
      const staff = await tx.insert(staffUsers).values([1, 2].map(n => ({
        name: `Test counter ${n}`, username: `${marker}-${n}`, passwordHash: "test-only", role: "COUNTER" as const,
      }))).returning();
      const [one, two] = staff;
      const codes = [`A-${marker}`, `B-${marker}`, `C-${marker}`, `D-${marker}`].map(c => c.toUpperCase());
      await tx.insert(bookings).values(codes.map((code, i) => ({
        bookingCode: code, idempotencyKey: code, channel: i === 3 ? "ONLINE" as const : "COUNTER" as const,
        status: i === 3 ? "PAID" as const : "CASH_CONFIRMED" as const,
        createdByStaffId: i === 3 ? null : i === 2 ? two!.id : one!.id,
        counterTender: i === 3 ? null : i === 1 ? "UPI" as const : "CASH" as const,
        visitorCount: 1, amountTotal: 10000, perVisitorPaise: 10000, visitDate: today,
        customerName: marker, customerPhone: "9876500123",
      })));
      async function lookup(query: string) {
        const rows = await tx.select({ code: bookings.bookingCode }).from(bookings)
          .where(and(eq(bookings.customerName, marker), counterLookupMatches(one!.id, today, query)));
        return rows.map(r => r.code).sort();
      }
      assert.deepEqual(await lookup(""), codes.slice(0, 2).sort());
      assert.deepEqual(await lookup(marker), codes.slice(0, 2).sort());
      assert.deepEqual(await lookup("9876500123"), codes.slice(0, 2).sort());
      assert.deepEqual(await lookup(codes[2]!.toLowerCase()), [codes[2]]);
      assert.deepEqual(await lookup(codes[3]!.toLowerCase()), [codes[3]]);
      assert.deepEqual(await lookup("%"), codes.slice(0, 2).sort());
      for (const [channel, counter, expected] of [
        ["COUNTER_CASH", one!.id, [codes[0]]],
        ["COUNTER_UPI", one!.id, [codes[1]]],
        ["COUNTER", two!.id, [codes[2]]],
        ["ONLINE", "", [codes[3]]],
        ["ONLINE", one!.id, []],
      ] as const) {
        const filters = parseFilters({ range: "today", channel, counter, q: marker });
        const roundTrip = parseFilters(Object.fromEntries(new URLSearchParams(filtersToQuery(filters, { page: 2 }))));
        assert.equal(roundTrip.counterId, counter || undefined);
        assert.equal(roundTrip.channel, channel);
        assert.equal(roundTrip.page, 2);
        const rows = await tx.select({ code: bookings.bookingCode }).from(bookings).where(whereFor(filters));
        assert.deepEqual(rows.map(r => r.code).sort(), [...expected].sort());
      }
      assert.equal(parseFilters({ counter: "bad-id" }).counterId, undefined);
      console.log("PASS: own-counter browsing, name/phone/partial/wildcard searches, exact cross-counter and online lookup, payment + counter filters, and URL round trips");
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  } finally {
    await pool.end();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
