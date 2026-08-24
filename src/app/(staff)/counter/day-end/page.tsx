import Link from "next/link";

import { requirePageStaff } from "@/lib/auth/guards";
import { dayEndSummary, type TenderTotals } from "@/domain/reports/counter";
import { formatPaise } from "@/lib/money";
import { businessDate, formatClockTime, formatDateTime, formatVisitDate, serverNow } from "@/lib/time";
import { PrintButton } from "../ticket/[code]/print-button";

export const metadata = { title: "Day's sales — Lion Safari" };
export const dynamic = "force-dynamic";

/**
 * The slip counter staff print at handover.
 *
 * Deliberately a summary and not a list of every ticket. A busy day is a few
 * hundred sales, and a metre of thermal paper nobody reads is not a record —
 * the per-ticket detail already lives in admin and in the nightly CSV, which is
 * where anyone actually reconciling goes. What has to be on paper is the figure
 * the drawer gets checked against, and enough context to explain it if it is
 * short.
 *
 * Scoped to the signed-in staff member, matching the shift totals on /counter:
 * a drawer is handed over by a person, not by a building.
 */
export default async function DayEndPage() {
  const staff = await requirePageStaff(["COUNTER"]);
  const today = businessDate();
  const summary = await dayEndSummary(staff.id, today);
  const printedAt = serverNow();

  return (
    <main className="mx-auto w-full max-w-md px-4 py-5">
      <div className="no-print mb-4 flex items-center justify-between gap-3">
        <Link href="/counter" className="text-sm text-brand underline underline-offset-4">
          ← Back to counter
        </Link>
        <PrintButton />
      </div>

      <article className="ticket mx-auto w-full overflow-hidden rounded-2xl border border-line bg-surface print:rounded-none">
        <header className="px-4 pb-3 pt-4 text-center">
          <h1 className="font-display text-2xl tracking-wide text-brand">M.C.Z.P Chhatbir</h1>
          <p className="text-muted text-[9px] uppercase tracking-[0.3em]">Wildlife Safari</p>
          <p className="mt-2.5 text-sm font-bold uppercase tracking-[0.16em]">Day&rsquo;s sales</p>
        </header>

        <div className="border-t border-dashed border-line" aria-hidden />

        <dl className="px-4 py-2.5 text-sm">
          <Row label="Date" value={formatVisitDate(today)} />
          <Row label="Counter" value={staff.name} />
          <Row
            label="Shift"
            value={
              summary.firstSaleAt && summary.lastSaleAt
                ? `${formatClockTime(summary.firstSaleAt)} – ${formatClockTime(summary.lastSaleAt)}`
                : "No sales yet"
            }
          />
        </dl>

        <div className="border-t border-dashed border-line" aria-hidden />

        {/* The split is the point of the slip: cash is checked against the
            drawer, UPI against the account. */}
        <div className="px-4 py-3">
          <TenderBlock label="Cash" totals={summary.cash} />
          <TenderBlock label="UPI" totals={summary.upi} />

          <div className="mt-2 flex items-baseline justify-between gap-4 border-t-2 border-double border-line pt-2.5">
            <div>
              <dt className="text-[11px] font-semibold uppercase tracking-[0.16em]">Total taken</dt>
              <dd className="text-muted text-[11px]">
                {summary.total.sales} ticket{summary.total.sales === 1 ? "" : "s"} ·{" "}
                {summary.total.visitors} visitor{summary.total.visitors === 1 ? "" : "s"}
              </dd>
            </div>
            <span className="text-xl font-bold tabular-nums">
              {formatPaise(summary.total.amount)}
            </span>
          </div>
        </div>

        {summary.byRate.length > 0 ? (
          <>
            <div className="border-t border-dashed border-line" aria-hidden />
            <div className="px-4 py-2.5">
              <p className="text-muted text-[9px] font-semibold uppercase tracking-[0.16em]">
                Sold at
              </p>
              <dl className="mt-1 text-sm">
                {summary.byRate.map((rate) => (
                  <Row
                    key={rate.label}
                    label={rate.label}
                    value={`${rate.sales} × · ${formatPaise(rate.amount)}`}
                  />
                ))}
              </dl>
            </div>
          </>
        ) : null}

        {summary.cancelled.sales > 0 ? (
          <>
            <div className="border-t border-dashed border-line" aria-hidden />
            <div className="px-4 py-2.5">
              <dl className="text-sm">
                <Row
                  label="Cancelled"
                  value={`${summary.cancelled.sales} · ${formatPaise(summary.cancelled.amount)}`}
                />
              </dl>
              <p className="text-muted mt-1 text-[9.5px] leading-snug">
                Already excluded from the totals above. Listed so a short drawer has a visible
                explanation.
              </p>
            </div>
          </>
        ) : null}

        <div className="border-t border-dashed border-line" aria-hidden />

        <footer className="px-4 pb-4 pt-2.5">
          <p className="text-muted text-[9px] uppercase tracking-[0.16em]">
            Printed {formatDateTime(printedAt)}
          </p>
          <div className="mt-6 flex gap-3 text-[9px] uppercase tracking-[0.16em]">
            <span className="text-muted flex-1 border-t border-line pt-1">Counter staff</span>
            <span className="text-muted flex-1 border-t border-line pt-1">Received by</span>
          </div>
        </footer>
      </article>
    </main>
  );
}

function TenderBlock({ label, totals }: { label: string; totals: TenderTotals }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-dotted border-line py-1.5 last:border-0">
      <div>
        <dt className="text-[11px] font-semibold uppercase tracking-[0.14em]">{label}</dt>
        <dd className="text-muted text-[11px]">
          {totals.sales} ticket{totals.sales === 1 ? "" : "s"} · {totals.visitors} visitor
          {totals.visitors === 1 ? "" : "s"}
        </dd>
      </div>
      <span className="text-base font-bold tabular-nums">{formatPaise(totals.amount)}</span>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="ticket-row flex items-baseline justify-between gap-3 border-b border-dotted border-line py-1 last-of-type:border-0">
      <dt className="text-muted shrink-0 text-[11px] uppercase tracking-[0.12em]">{label}</dt>
      <dd className="text-right text-[13px] font-medium">{value}</dd>
    </div>
  );
}
