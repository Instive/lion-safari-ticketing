import Link from "next/link";

import { requirePageStaff } from "@/lib/auth/guards";
import { formatPaise } from "@/lib/money";
import { formatLocalTime, formatVisitDate } from "@/lib/time";
import {
  PAGE_SIZE,
  bookingTotals,
  countBookings,
  dailyTotals,
  filtersToQuery,
  listBookings,
  parseFilters,
} from "@/domain/reports/bookings";
import { StatusPill } from "../status-pill";
import { EmailReportButton } from "./email-report-button";
import { FilterBar } from "./filter-bar";

export const metadata = { title: "Bookings — Lion Safari" };
export const dynamic = "force-dynamic";

export default async function AdminBookingsPage({ searchParams }: PageProps<"/admin/bookings">) {
  await requirePageStaff(["ADMIN"]);

  const filters = parseFilters(await searchParams);
  const singleDay = filters.from === filters.to;

  const [rows, totals, total, byDay] = await Promise.all([
    listBookings(filters),
    bookingTotals(filters),
    countBookings(filters),
    singleDay ? Promise.resolve([]) : dailyTotals(filters),
  ]);

  const query = filtersToQuery(filters);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(filters.page, pageCount);
  const busiest = byDay.reduce((max, day) => Math.max(max, day.collectedPaise), 0);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/admin" className="text-muted text-sm hover:text-foreground">
            ← Dashboard
          </Link>
          <h1 className="mt-1 text-2xl font-semibold">Bookings</h1>
          <p className="text-muted text-sm">
            {singleDay
              ? formatVisitDate(filters.from)
              : `${formatVisitDate(filters.from)} — ${formatVisitDate(filters.to)}`}
            {" · by "}
            {filters.dateField === "visit" ? "visit date" : "booking date"}
          </p>
        </div>

        <div className="flex flex-wrap items-start gap-2">
          {/* A plain link, so the browser downloads it and the same query string
              that built this page defines the file. */}
          <a
            href={`/admin/bookings/export?${query}`}
            className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white hover:bg-brand-strong"
          >
            Download CSV
          </a>
          {singleDay ? <EmailReportButton businessDate={filters.from} /> : null}
        </div>
      </div>

      <FilterBar filters={filters} />

      <section className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Collected"
          value={formatPaise(totals.collectedPaise)}
          hint={`${totals.confirmedBookings} confirmed of ${totals.bookings}`}
          emphasis
        />
        <Stat label="Visitors" value={String(totals.visitors)} hint={`${totals.boarded} boarded`} />
        <Stat
          label="Online / counter"
          value={`${totals.online} / ${totals.counter}`}
          hint="Confirmed bookings by channel"
        />
        <Stat
          label={totals.refundedPaise > 0 ? "Refunded" : "Awaiting payment"}
          value={
            totals.refundedPaise > 0 ? formatPaise(totals.refundedPaise) : String(totals.pending)
          }
          hint={totals.refundedPaise > 0 ? "Not netted off collected" : "Reconciliation sweeps these"}
        />
      </section>

      {byDay.length > 1 ? (
        <section className="mt-4 rounded-xl border border-line bg-surface p-4">
          <h2 className="text-muted mb-3 text-sm font-medium">Day by day</h2>
          <ul className="space-y-1.5">
            {byDay.map((day) => (
              <li key={day.date} className="flex items-center gap-3 text-sm">
                <Link
                  href={`/admin/bookings?${filtersToQuery(filters, {
                    preset: "custom",
                    from: day.date,
                    to: day.date,
                    page: 1,
                  })}`}
                  className="w-32 shrink-0 whitespace-nowrap tabular-nums text-brand hover:underline"
                >
                  {formatVisitDate(day.date)}
                </Link>
                <span className="bg-background relative h-4 flex-1 overflow-hidden rounded">
                  <span
                    className="absolute inset-y-0 left-0 rounded bg-brand/70"
                    style={{ width: busiest ? `${(day.collectedPaise / busiest) * 100}%` : "0%" }}
                  />
                </span>
                <span className="text-muted w-16 shrink-0 text-right tabular-nums">
                  {day.visitors} vis.
                </span>
                <span className="w-24 shrink-0 text-right font-medium tabular-nums">
                  {formatPaise(day.collectedPaise)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="mt-4 overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full min-w-[52rem] text-sm">
          <thead className="border-b border-line text-left">
            <tr className="text-muted">
              <th className="px-4 py-3 font-medium">Booking</th>
              <th className="px-4 py-3 font-medium">Guest</th>
              <th className="px-4 py-3 font-medium">Visit</th>
              <th className="px-4 py-3 font-medium">Visitors</th>
              <th className="px-4 py-3 font-medium">Amount</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Booked</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-muted px-4 py-10 text-center">
                  No bookings match this filter.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/bookings/${r.bookingCode}`}
                      className="font-mono font-semibold tracking-wider text-brand underline"
                    >
                      {r.bookingCode}
                    </Link>
                    <p className="text-muted text-xs">
                      {r.channel.toLowerCase()}
                      {r.soldBy ? ` · ${r.soldBy}` : ""}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    {r.customerName ?? <span className="text-muted">—</span>}
                    {r.customerPhone ? (
                      <p className="text-muted text-xs">{r.customerPhone}</p>
                    ) : null}
                  </td>
                  <td className="text-muted px-4 py-3 whitespace-nowrap">
                    {formatVisitDate(r.visitDate)}
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    {r.visitorCount}
                    {r.boardedCount > 0 ? (
                      <span className="text-muted text-xs"> · {r.boardedCount} boarded</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 tabular-nums">{formatPaise(r.amountTotal)}</td>
                  <td className="px-4 py-3">
                    <StatusPill status={r.status} ticketStatus={r.ticketStatus} />
                  </td>
                  <td className="text-muted px-4 py-3 whitespace-nowrap">
                    {formatLocalTime(r.createdAt)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {total > PAGE_SIZE ? (
        <nav className="mt-3 flex items-center justify-between text-sm" aria-label="Pagination">
          <p className="text-muted">
            {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
          </p>
          <div className="flex gap-2">
            <PageLink
              href={`/admin/bookings?${filtersToQuery(filters, { page: page - 1 })}`}
              disabled={page <= 1}
            >
              ← Newer
            </PageLink>
            <PageLink
              href={`/admin/bookings?${filtersToQuery(filters, { page: page + 1 })}`}
              disabled={page >= pageCount}
            >
              Older →
            </PageLink>
          </div>
        </nav>
      ) : null}
    </main>
  );
}

function PageLink({
  href,
  disabled,
  children,
}: {
  href: string;
  disabled: boolean;
  children: React.ReactNode;
}) {
  if (disabled) {
    return (
      <span className="text-muted rounded-lg border border-line px-3 py-1.5 opacity-50">
        {children}
      </span>
    );
  }
  return (
    <Link href={href} className="rounded-lg border border-line px-3 py-1.5 hover:border-brand">
      {children}
    </Link>
  );
}

function Stat({
  label,
  value,
  hint,
  emphasis,
}: {
  label: string;
  value: string;
  hint?: string;
  emphasis?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-4 ${
        emphasis ? "border-brand/30 bg-brand/5" : "border-line bg-surface"
      }`}
    >
      <p className="text-muted text-sm">{label}</p>
      <p className={`mt-1 font-bold tabular-nums ${emphasis ? "text-2xl text-brand" : "text-xl"}`}>
        {value}
      </p>
      {hint ? <p className="text-muted mt-1 text-xs">{hint}</p> : null}
    </div>
  );
}
