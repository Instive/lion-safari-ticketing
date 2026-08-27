import Link from "next/link";

import { requirePageStaff } from "@/lib/auth/guards";
import { formatLocalTime, formatVisitDate } from "@/lib/time";
import {
  bookDiscrepancies,
  bookStock,
  misdatedOfflineSales,
  offlineSalesFor,
} from "@/domain/reports/ticket-books";
import { formatPaise } from "@/lib/money";
import { businessDate } from "@/lib/time";

export const metadata = { title: "Ticket books — Lion Safari" };
export const dynamic = "force-dynamic";

/** How far back to look for blanks used at the gate but never sold. */
const DISCREPANCY_WINDOW_DAYS = 30;

export default async function AdminBooksPage() {
  await requirePageStaff(["ADMIN"]);

  const today = businessDate();
  const from = shiftDays(today, -DISCREPANCY_WINDOW_DAYS);

  const [stock, discrepancies, misdated, offline] = await Promise.all([
    bookStock(today),
    bookDiscrepancies(from, today),
    misdatedOfflineSales(from, today),
    offlineSalesFor(from, today),
  ]);

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-6">
      <Link href="/admin" className="text-muted text-sm hover:text-foreground">
        ← Dashboard
      </Link>
      <h1 className="mt-1 text-2xl font-semibold">Ticket books</h1>
      <p className="text-muted mb-5 text-sm">
        Tickets pre-issued to each counter so it can keep selling with no internet. A blank is
        valid at the gate before it is paid for, so the point of this page is that every one is
        accounted for.
      </p>

      {/* The thing worth interrupting someone for, first. */}
      {discrepancies.length > 0 ? (
        <section className="mb-5 rounded-xl border border-danger/40 bg-danger/5 p-4">
          <h2 className="font-semibold text-danger">
            {discrepancies.length} ticket{discrepancies.length === 1 ? "" : "s"} boarded with no
            recorded sale
          </h2>
          <p className="text-muted mt-1 text-sm">
            These groups were admitted on a pre-issued ticket that never turned into a sale.
            Usually a counter whose queue has not synced — check that till is online before the
            cash is banked.
          </p>
          <ul className="mt-3 space-y-2">
            {discrepancies.map((row) => (
              <li
                key={row.bookingId}
                className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-sm"
              >
                <span className="font-mono font-semibold tracking-wider">{row.bookingCode}</span>
                <span className="text-muted">
                  {row.visitorCount} visitor{row.visitorCount === 1 ? "" : "s"} ·{" "}
                  {formatVisitDate(row.visitDate)} · {row.deviceName ?? "unknown till"}
                </span>
                <span className="text-muted text-xs">
                  {row.boardedAt ? `boarded ${formatLocalTime(row.boardedAt)}` : "boarded"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="mb-5 rounded-xl border border-ok/30 bg-ok/5 px-4 py-3 text-sm text-ok">
          Every pre-issued ticket used at the gate in the last {DISCREPANCY_WINDOW_DAYS} days has a
          matching sale.
        </p>
      )}

      {/*
        A ticket is only admissible on the day it is dated for, so a sale made
        on a different day than the ticket it handed over is a guest who was
        turned away at the gate having already paid. The till is supposed to
        make this impossible (src/lib/counter/park-day.ts) — this is how anyone
        would find out if it ever stopped doing so.
      */}
      {misdated.length > 0 ? (
        <section className="mb-5 rounded-xl border border-danger/40 bg-danger/5 p-4">
          <h2 className="font-semibold text-danger">
            {misdated.length} ticket{misdated.length === 1 ? "" : "s"} sold for the wrong day
          </h2>
          <p className="text-muted mt-1 text-sm">
            These were sold on one day but dated for another, so the gate would have refused them.
            Each is likely owed a refund or a replacement ticket. Check the till&rsquo;s date and
            that it is syncing.
          </p>
          <ul className="mt-3 space-y-2">
            {misdated.map((row) => (
              <li
                key={row.bookingId}
                className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-sm"
              >
                <span className="font-mono font-semibold tracking-wider">{row.bookingCode}</span>
                <span className="text-muted">
                  sold {formatVisitDate(row.soldOnDay)} · dated{" "}
                  {formatVisitDate(row.visitDate)} · {row.deviceName ?? "unknown till"}
                </span>
                <span className="text-muted text-xs">
                  {formatPaise(row.amountTotal)} ·{" "}
                  {row.boardedAt ? `boarded ${formatLocalTime(row.boardedAt)}` : "never boarded"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mb-5 rounded-xl border border-line bg-surface p-4">
        <h2 className="text-muted text-sm">Sold while offline · last {DISCREPANCY_WINDOW_DAYS} days</h2>
        <p className="mt-1 text-2xl font-bold tabular-nums">
          {formatPaise(offline.collectedPaise)}
          <span className="text-muted ml-2 text-sm font-medium">
            {offline.count} sale{offline.count === 1 ? "" : "s"} · {offline.visitors} visitors
          </span>
        </p>
      </section>

      <h2 className="mb-2 font-semibold">Stock on each till</h2>
      {stock.length === 0 ? (
        <p className="text-muted rounded-xl border border-line bg-surface p-4 text-sm">
          No counter device is holding a ticket book yet. Register a till under{" "}
          <Link href="/admin/devices" className="text-brand underline">
            Devices
          </Link>{" "}
          and open the counter on it once — the book fills itself.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full min-w-[34rem] text-sm">
            <thead className="border-b border-line text-left">
              <tr className="text-muted">
                <th className="px-4 py-3 font-medium">Till</th>
                <th className="px-4 py-3 font-medium">For</th>
                <th className="px-4 py-3 font-medium">Unsold</th>
                <th className="px-4 py-3 font-medium">Sold</th>
              </tr>
            </thead>
            <tbody>
              {stock.map((row) => (
                <tr
                  key={`${row.deviceId}-${row.visitDate}`}
                  className="border-b border-line last:border-0"
                >
                  <td className="px-4 py-3">
                    {row.deviceName}
                    {!row.deviceActive ? (
                      <span className="text-danger ml-2 text-xs font-semibold uppercase">
                        deactivated
                      </span>
                    ) : null}
                  </td>
                  <td className="text-muted px-4 py-3 whitespace-nowrap">
                    {formatVisitDate(row.visitDate)}
                  </td>
                  <td className="px-4 py-3 tabular-nums">{row.unsold}</td>
                  <td className="px-4 py-3 tabular-nums">{row.sold}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

/** Calendar-date arithmetic only — never touches a clock, so no timezone shift. */
function shiftDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10);
}
