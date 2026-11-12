import Link from "next/link";
import { filtersToQuery, type BookingFilters } from "@/domain/reports/filter-options";
import type { salesByCounter } from "@/domain/reports/bookings";
import { formatPaise } from "@/lib/money";

export function CounterSales({ filters, counters, rows }: {
  filters: BookingFilters;
  counters: { id: string; username: string }[];
  rows: Awaited<ReturnType<typeof salesByCounter>>;
}) {
  const visible = counters.filter(c => !filters.counterId || c.id === filters.counterId);
  if (filters.channel === "ONLINE") return null;
  const unassigned = rows.find(r => r.id === null);
  return (
    <section className="mt-4" aria-label="Sales by counter">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">Sales by counter</h2>
        <p className="text-muted text-xs">Confirmed sales · current filters</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {visible.map(counter => {
          const row = rows.find(r => r.id === counter.id);
          return (
            <Link key={counter.id} href={`/admin/bookings?${filtersToQuery(filters, { counterId: counter.id, page: 1 })}`}
              className="rounded-xl border border-line bg-surface p-4 transition-colors hover:border-brand focus-visible:outline-brand">
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-semibold">{counter.username}</h3>
                <span className="rounded-full bg-brand/10 px-2 py-1 text-xs text-brand">{row?.sales ?? 0} tickets</span>
              </div>
              <p className="mt-3 text-2xl font-bold tabular-nums">{formatPaise(row?.total ?? 0)}</p>
              <dl className="mt-3 grid grid-cols-2 gap-3 border-t border-line pt-3 text-sm">
                <div><dt className="text-muted">Cash</dt><dd className="mt-1 font-medium tabular-nums">{formatPaise(row?.cash ?? 0)}</dd></div>
                <div><dt className="text-muted">UPI</dt><dd className="mt-1 font-medium tabular-nums">{formatPaise(row?.upi ?? 0)}</dd></div>
              </dl>
              <p className="mt-3 text-xs font-medium text-brand">View tickets →</p>
            </Link>
          );
        })}
      </div>
      {visible.length === 0 ? <p className="text-muted text-sm">No counters match this selection.</p> : null}
      {unassigned ? <p className="mt-3 text-sm text-muted">Unassigned counter sales: {formatPaise(unassigned.total)} · {unassigned.sales} tickets</p> : null}
    </section>
  );
}
