import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import Link from "next/link";

import { db } from "@/db";
import { rateCategories } from "@/db/schema";
import { requirePageStaff } from "@/lib/auth/guards";
import { MAX_VISITORS_PER_BOOKING } from "@/domain/booking/pricing";
import { dayEndSummary, recentCounterSales } from "@/domain/reports/counter";
import { env } from "@/lib/env";
import { formatPaise } from "@/lib/money";
import { businessDate, formatLocalTime, formatVisitDate } from "@/lib/time";
import { CounterForm } from "./counter-form";

export const metadata = { title: "Counter — Lion Safari" };
export const dynamic = "force-dynamic";

export default async function CounterPage() {
  const staff = await requirePageStaff(["COUNTER"]);
  const today = businessDate();

  const [summary, recentSales, rates] = await Promise.all([
    // What this staff member should be able to hand over at the end of the
    // shift, split the way it will be checked: cash against the drawer, UPI
    // against the account. Cancelled sales are excluded — that money went back
    // out — but the day-end slip reports them so a short drawer is explainable.
    dayEndSummary(staff.id, today),

    // The fast, reliable way to answer "did my last sale actually go through" —
    // without it, an unsure staff member's only recourse is guessing or a
    // separate lookup search. Ordered by when the cash was taken, so a sale made
    // during an outage appears in its true place once it reconciles rather than
    // back at the moment its blank was minted.
    recentCounterSales(staff.id, today),

    // Concession rates the counter may sell at. Only the name and price cross
    // to the browser; the price that is actually charged is re-read server-side
    // from this same table when the sale is made.
    db
      .select({
        id: rateCategories.id,
        name: rateCategories.name,
        perVisitorPaise: rateCategories.perVisitorPaise,
      })
      .from(rateCategories)
      .where(eq(rateCategories.active, true))
      .orderBy(asc(rateCategories.perVisitorPaise)),
  ]);

  return (
    <main className="mx-auto w-full max-w-lg px-4 py-5">
      <header className="mb-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Cash counter</h1>
            <p className="text-muted text-sm">
              {formatVisitDate(today)} · {staff.name}
            </p>
          </div>
          <Link
            href="/counter/lookup"
            className="touch-target grid shrink-0 place-items-center rounded-xl border border-line bg-surface px-4 text-sm font-semibold hover:border-brand"
          >
            Find a ticket
          </Link>
        </div>

        {/* Shift running total, so cash in the drawer can be checked against
            the system at any point without leaving this screen. */}
        <dl className="mt-4 grid grid-cols-3 divide-x divide-line overflow-hidden rounded-xl border border-line bg-surface">
          <ShiftStat label="Sales" value={String(summary.total.sales)} />
          <ShiftStat label="Visitors" value={String(summary.total.visitors)} />
          <ShiftStat label="Taken" value={formatPaise(summary.total.amount)} />
        </dl>

        <div className="mt-2 flex items-center justify-between gap-3 text-xs">
          <p className="text-muted tabular-nums">
            Cash {formatPaise(summary.cash.amount)} · UPI {formatPaise(summary.upi.amount)}
          </p>
          <Link href="/counter/day-end" className="shrink-0 text-brand underline underline-offset-4">
            Print day&rsquo;s sales
          </Link>
        </div>
      </header>

      <CounterForm
        perVisitorPaise={env.TICKET_PRICE_PAISE}
        maxVisitors={MAX_VISITORS_PER_BOOKING}
        rates={rates}
        staffId={staff.id}
        idempotencyKey={randomUUID()}
      />

      {recentSales.length > 0 ? (
        <section className="mt-8">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-muted text-sm font-medium">Your last sales today</h2>
            <Link href="/counter/lookup" className="text-xs text-brand underline">
              See all
            </Link>
          </div>
          <ul className="space-y-2">
            {recentSales.map((sale) => {
              const voided = sale.status !== "CASH_CONFIRMED";
              return (
                <li key={sale.bookingCode}>
                  <Link
                    href={`/counter/ticket/${sale.bookingCode}`}
                    className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface px-3 py-3 text-sm transition-colors hover:border-brand"
                  >
                    <span className="min-w-0">
                      <span className="flex items-center gap-2">
                        <span className="font-mono font-semibold tracking-wider">
                          {sale.bookingCode}
                        </span>
                        {voided ? (
                          <span className="rounded bg-danger/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-danger">
                            {sale.status.toLowerCase()}
                          </span>
                        ) : null}
                        {/* Says both "this reconciled" and "this time came from
                            the till's clock, not the server's". */}
                        {sale.soldOffline ? (
                          <span className="text-muted rounded bg-line/50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
                            offline
                          </span>
                        ) : null}
                      </span>
                      <span className="text-muted block">
                        {sale.visitorCount} visitor{sale.visitorCount === 1 ? "" : "s"} ·{" "}
                        {formatPaise(sale.amountTotal)}
                      </span>
                    </span>
                    <span className="text-muted shrink-0 text-right text-xs">
                      {formatLocalTime(sale.soldAt)}
                      <span className="mt-0.5 block text-brand">Reprint →</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </main>
  );
}

function ShiftStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-3 py-2.5 text-center">
      <dt className="text-muted text-[11px] uppercase tracking-wide">{label}</dt>
      <dd className="mt-0.5 text-lg font-bold tabular-nums">{value}</dd>
    </div>
  );
}
