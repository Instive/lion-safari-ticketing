import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import Link from "next/link";

import { db } from "@/db";
import { bookings } from "@/db/schema";
import { requirePageStaff } from "@/lib/auth/guards";
import { MAX_VISITORS_PER_BOOKING } from "@/domain/booking/pricing";
import { env } from "@/lib/env";
import { formatPaise } from "@/lib/money";
import { formatLocalTime, formatVisitDate } from "@/lib/time";
import { businessDate } from "@/lib/time";
import { CounterForm } from "./counter-form";

export const metadata = { title: "Counter — Lion Safari" };
export const dynamic = "force-dynamic";

export default async function CounterPage() {
  const staff = await requirePageStaff(["COUNTER"]);
  const today = businessDate();

  // The fast, reliable way to answer "did my last sale actually go through" —
  // without it, an unsure staff member's only recourse is guessing or a
  // separate lookup search, which is exactly the failure mode Fix 1 above
  // protects against but doesn't give staff visibility into on its own.
  const recentSales = await db
    .select({
      bookingCode: bookings.bookingCode,
      visitorCount: bookings.visitorCount,
      amountTotal: bookings.amountTotal,
      createdAt: bookings.createdAt,
    })
    .from(bookings)
    .where(
      and(
        eq(bookings.channel, "COUNTER"),
        eq(bookings.createdByStaffId, staff.id),
        eq(bookings.visitDate, today),
      ),
    )
    .orderBy(desc(bookings.createdAt))
    .limit(5);

  return (
    <main className="mx-auto w-full max-w-md px-4 py-6">
      <div className="mb-5 flex items-baseline justify-between">
        <div>
          <h1 className="text-xl font-semibold">Cash booking</h1>
          <p className="text-muted text-sm">{formatVisitDate(today)}</p>
        </div>
        <Link href="/counter/lookup" className="text-sm text-brand underline">
          Find a ticket
        </Link>
      </div>

      <CounterForm
        perVisitorPaise={env.TICKET_PRICE_PAISE}
        maxVisitors={MAX_VISITORS_PER_BOOKING}
        idempotencyKey={randomUUID()}
      />

      {recentSales.length > 0 ? (
        <section className="mt-8">
          <h2 className="text-muted mb-2 text-sm font-medium">Your last sales today</h2>
          <ul className="space-y-2">
            {recentSales.map((sale) => (
              <li key={sale.bookingCode}>
                <Link
                  href={`/counter/ticket/${sale.bookingCode}`}
                  className="flex items-center justify-between rounded-lg border border-line bg-surface px-3 py-2.5 text-sm hover:border-brand"
                >
                  <span className="flex items-center gap-2">
                    <span className="font-mono font-semibold tracking-wider">
                      {sale.bookingCode}
                    </span>
                    <span className="text-muted">
                      {sale.visitorCount} visitor{sale.visitorCount === 1 ? "" : "s"} ·{" "}
                      {formatPaise(sale.amountTotal)}
                    </span>
                  </span>
                  <span className="text-muted text-xs">{formatLocalTime(sale.createdAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
