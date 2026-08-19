import { and, desc, eq, or, like } from "drizzle-orm";
import Link from "next/link";

import { db } from "@/db";
import { bookings, tickets } from "@/db/schema";
import { requirePageStaff } from "@/lib/auth/guards";
import { formatPaise } from "@/lib/money";
import { businessDate, formatLocalTime, formatVisitDate } from "@/lib/time";

export const metadata = { title: "Find a ticket — Lion Safari" };
export const dynamic = "force-dynamic";

/**
 * Lost-ticket recovery at the counter (spec §9): find the existing ticket by
 * booking code or phone and reprint it. Never issues a new one.
 *
 * With no search text, this browses today's counter sales instead of showing
 * nothing — staff who remembers "about an hour ago, six people" but not the
 * exact code or phone number still has a way to find it, not just a dead end.
 */
export default async function LookupPage({ searchParams }: PageProps<"/counter/lookup">) {
  await requirePageStaff(["COUNTER"]);
  const { q } = await searchParams;
  const query = typeof q === "string" ? q.trim() : "";
  const today = businessDate();

  const results = await db
    .select({
      bookingCode: bookings.bookingCode,
      visitorCount: bookings.visitorCount,
      amountTotal: bookings.amountTotal,
      visitDate: bookings.visitDate,
      customerName: bookings.customerName,
      customerPhone: bookings.customerPhone,
      createdAt: bookings.createdAt,
      status: tickets.status,
    })
    .from(bookings)
    .innerJoin(tickets, eq(tickets.bookingId, bookings.id))
    .where(
      query
        ? or(
            eq(bookings.bookingCode, query.toUpperCase()),
            like(bookings.customerPhone, `%${query}%`),
          )
        : and(eq(bookings.channel, "COUNTER"), eq(bookings.visitDate, today)),
    )
    .orderBy(desc(bookings.createdAt))
    .limit(query ? 20 : 30);

  return (
    <main className="mx-auto w-full max-w-md px-4 py-6">
      <h1 className="mb-1 text-xl font-semibold">Find a ticket</h1>
      <p className="text-muted mb-5 text-sm">
        Search by booking code or phone number — or browse today&rsquo;s counter sales below.
      </p>

      <form className="mb-6 flex gap-2">
        <input
          name="q"
          defaultValue={query}
          placeholder="LS7K2M9Q or 98765…"
          autoCapitalize="characters"
          className="touch-target flex-1 rounded-lg border border-line px-3 text-base outline-none focus:border-brand"
        />
        <button
          type="submit"
          className="touch-target rounded-lg bg-brand px-5 font-semibold text-white hover:bg-brand-strong"
        >
          Search
        </button>
      </form>

      {results.length === 0 ? (
        <p className="text-muted rounded-xl border border-line bg-surface p-4 text-sm">
          {query ? `No ticket found for "${query}".` : "No counter sales yet today."}
        </p>
      ) : (
        <p className="text-muted mb-2 text-xs uppercase tracking-wide">
          {query ? `Results for "${query}"` : "Today's counter sales"}
        </p>
      )}

      <ul className="space-y-3">
        {results.map((r) => (
          <li key={r.bookingCode}>
            <Link
              href={`/counter/ticket/${r.bookingCode}`}
              className="block rounded-xl border border-line bg-surface p-4 hover:border-brand"
            >
              <div className="flex items-baseline justify-between">
                <span className="font-mono font-bold tracking-wider">{r.bookingCode}</span>
                <span
                  className={`text-sm font-semibold ${
                    r.status === "ACTIVE" ? "text-ok" : "text-danger"
                  }`}
                >
                  {r.status === "ACTIVE" ? "Valid" : r.status.toLowerCase()}
                </span>
              </div>
              <p className="text-muted mt-1 text-sm">
                {r.visitorCount} visitor{r.visitorCount === 1 ? "" : "s"} ·{" "}
                {formatVisitDate(r.visitDate)} · {formatPaise(r.amountTotal)} ·{" "}
                {formatLocalTime(r.createdAt)}
              </p>
              {r.customerName || r.customerPhone ? (
                <p className="text-muted text-sm">
                  {[r.customerName, r.customerPhone].filter(Boolean).join(" · ")}
                </p>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
