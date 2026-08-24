import { and, desc, eq, ilike, or } from "drizzle-orm";
import Link from "next/link";

import { db } from "@/db";
import { bookings, tickets, type TicketStatus } from "@/db/schema";
import { requirePageStaff } from "@/lib/auth/guards";
import { formatPaise } from "@/lib/money";
import { businessDate, formatLocalTime, formatVisitDate } from "@/lib/time";

export const metadata = { title: "Find a ticket — Lion Safari" };
export const dynamic = "force-dynamic";

/**
 * Lost-ticket recovery at the counter (spec §9): find the existing ticket and
 * reprint it. Never issues a new one.
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

  /*
   * All three fields, all partial, all case-insensitive.
   *
   * The old search matched a booking code only in full and only in upper case,
   * which meant the one thing a guest can usually offer — most of the code off
   * a creased ticket, or their own name — found nothing at all. A guest who has
   * lost their ticket is the entire reason this screen exists.
   */
  const matches = query
    ? or(
        ilike(bookings.bookingCode, `%${query}%`),
        ilike(bookings.customerPhone, `%${query}%`),
        ilike(bookings.customerName, `%${query}%`),
      )
    : and(eq(bookings.channel, "COUNTER"), eq(bookings.visitDate, today));

  const results = await db
    .select({
      bookingCode: bookings.bookingCode,
      visitorCount: bookings.visitorCount,
      amountTotal: bookings.amountTotal,
      visitDate: bookings.visitDate,
      customerName: bookings.customerName,
      customerPhone: bookings.customerPhone,
      counterTender: bookings.counterTender,
      createdAt: bookings.createdAt,
      status: tickets.status,
    })
    .from(bookings)
    .innerJoin(tickets, eq(tickets.bookingId, bookings.id))
    .where(matches)
    .orderBy(desc(bookings.createdAt))
    .limit(query ? 30 : 40);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Find a ticket</h1>
          <p className="text-muted mt-0.5 text-sm">
            Reprints the ticket that already exists — it never issues a new one.
          </p>
        </div>
        <Link
          href="/counter"
          className="touch-target grid shrink-0 place-items-center rounded-xl border border-line bg-surface px-4 text-sm font-semibold hover:border-brand"
        >
          Back to counter
        </Link>
      </div>

      <form className="flex gap-2">
        <input
          name="q"
          defaultValue={query}
          placeholder="Booking code, phone number or name"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          // Autofocused because staff arrive here with a guest waiting and
          // something to type; nothing else on this screen wants the caret.
          autoFocus
          className="touch-target min-w-0 flex-1 rounded-xl border border-line bg-surface px-4 text-base outline-none focus:border-brand"
        />
        <button
          type="submit"
          className="touch-target shrink-0 rounded-xl bg-brand px-5 font-semibold text-white hover:bg-brand-strong"
        >
          Search
        </button>
      </form>

      <div className="mt-5 mb-2 flex items-baseline justify-between gap-3">
        <p className="text-muted text-xs uppercase tracking-wide">
          {query ? `Matching “${query}”` : "Today’s counter sales"}
          {results.length > 0 ? ` · ${results.length}` : ""}
        </p>
        {query ? (
          <Link
            href="/counter/lookup"
            className="text-brand shrink-0 text-xs font-semibold underline underline-offset-4"
          >
            Clear search
          </Link>
        ) : null}
      </div>

      {results.length === 0 ? (
        <div className="rounded-xl border border-line bg-surface p-5 text-sm">
          {query ? (
            <>
              <p className="font-semibold">Nothing matched “{query}”.</p>
              <p className="text-muted mt-1">
                Part of the booking code works, and so does part of a phone number or name. If the
                ticket was bought online, check the guest&rsquo;s SMS or email for the code.
              </p>
            </>
          ) : (
            <p className="text-muted">No counter sales yet today.</p>
          )}
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {results.map((r) => (
            <li key={r.bookingCode}>
              <Link
                href={`/counter/ticket/${r.bookingCode}`}
                className="flex h-full flex-col rounded-xl border border-line bg-surface p-4 transition-colors hover:border-brand"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono font-bold tracking-wider">{r.bookingCode}</span>
                  <StatusChip status={r.status} />
                </div>

                <p className="mt-2 text-sm font-semibold tabular-nums">
                  {r.visitorCount} visitor{r.visitorCount === 1 ? "" : "s"} ·{" "}
                  {formatPaise(r.amountTotal)}
                </p>
                <p className="text-muted mt-0.5 text-xs">
                  {formatVisitDate(r.visitDate)} · {formatLocalTime(r.createdAt)}
                  {r.counterTender ? ` · ${r.counterTender.toLowerCase()}` : ""}
                </p>

                {r.customerName || r.customerPhone ? (
                  <p className="text-muted mt-1.5 truncate text-xs">
                    {[r.customerName, r.customerPhone].filter(Boolean).join(" · ")}
                  </p>
                ) : null}

                <span className="text-brand mt-3 text-xs font-semibold">Open &amp; reprint →</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

/**
 * A ticket's state, said plainly.
 *
 * Worth its own chip rather than a coloured word: staff scanning this list are
 * deciding whether to reprint or to explain, and "already used" is the answer
 * that changes what they say to the guest standing in front of them.
 */
function StatusChip({ status }: { status: TicketStatus }) {
  const copy: Record<TicketStatus, { label: string; tone: string }> = {
    ACTIVE: { label: "Valid", tone: "border-ok/40 bg-ok/10 text-ok" },
    USED: { label: "Used", tone: "border-accent/40 bg-accent/10 text-accent" },
    CANCELLED: { label: "Cancelled", tone: "border-danger/40 bg-danger/10 text-danger" },
    EXPIRED: { label: "Expired", tone: "border-line bg-background text-muted" },
  };
  const { label, tone } = copy[status];

  return (
    <span
      className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${tone}`}
    >
      {label}
    </span>
  );
}
