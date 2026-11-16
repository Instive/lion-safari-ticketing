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
      <div className="grid gap-2 sm:grid-cols-2">
        {visible.map(counter => {
          const row = rows.find(r => r.id === counter.id);
          return (
            <Link key={counter.id} href={`/admin/bookings?${filtersToQuery(filters, { counterId: counter.id, page: 1 })}`}
              className="rounded-xl border border-line bg-surface p-3 transition-colors hover:border-brand focus-visible:outline-brand">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <h3 className="text-sm font-semibold">{counter.username}</h3>
                <span className="font-bold tabular-nums text-brand">{formatPaise(row?.total ?? 0)}</span>
              </div>
              <p className="text-muted mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
                <span>{row?.sales ?? 0} tickets</span>
                <span>Cash {formatPaise(row?.cash ?? 0)}</span>
                <span>UPI {formatPaise(row?.upi ?? 0)}</span>
              </p>
            </Link>
          );
        })}
      </div>
      {visible.length === 0 ? <p className="text-muted text-sm">No counters match this selection.</p> : null}
      {unassigned ? <p className="mt-3 text-sm text-muted">Unassigned counter sales: {formatPaise(unassigned.total)} · {unassigned.sales} tickets</p> : null}
    </section>
  );
}
