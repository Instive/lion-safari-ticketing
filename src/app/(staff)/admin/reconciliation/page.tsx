import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import Link from "next/link";

import { db } from "@/db";
import { bookings, paymentEvents, payments } from "@/db/schema";
import { requirePageStaff } from "@/lib/auth/guards";
import { formatPaise } from "@/lib/money";
import { formatLocalTime } from "@/lib/time";

export const metadata = { title: "Reconciliation — Lion Safari" };
export const dynamic = "force-dynamic";

/**
 * Where provider-versus-system disagreements surface (spec §4.3).
 *
 * Nothing here auto-resolves: an amount mismatch or an unknown order is a
 * decision for a person, so the system holds the booking unconfirmed and shows
 * it here rather than guessing.
 */
export default async function ReconciliationPage() {
  await requirePageStaff(["ADMIN"]);

  const problems = await db
    .select({
      id: paymentEvents.id,
      eventType: paymentEvents.eventType,
      error: paymentEvents.processingError,
      receivedAt: paymentEvents.receivedAt,
      bookingCode: bookings.bookingCode,
      bookingStatus: bookings.status,
      amountTotal: bookings.amountTotal,
    })
    .from(paymentEvents)
    .leftJoin(bookings, eq(bookings.id, paymentEvents.bookingId))
    .where(isNotNull(paymentEvents.processingError))
    .orderBy(desc(paymentEvents.receivedAt))
    .limit(100);

  const stuck = await db
    .select({
      bookingCode: bookings.bookingCode,
      amountTotal: bookings.amountTotal,
      createdAt: bookings.createdAt,
      providerOrderId: payments.providerOrderId,
      paymentStatus: payments.status,
    })
    .from(bookings)
    .innerJoin(payments, eq(payments.bookingId, bookings.id))
    .where(
      and(
        eq(bookings.status, "PENDING"),
        eq(bookings.channel, "ONLINE"),
        sql`${bookings.createdAt} < now() - interval '15 minutes'`,
        sql`${bookings.createdAt} > now() - interval '7 days'`,
      ),
    )
    .orderBy(desc(bookings.createdAt))
    .limit(100);

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-6">
      <div className="mb-5 flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">Payment reconciliation</h1>
        <Link href="/admin" className="text-sm text-brand underline">
          ← Dashboard
        </Link>
      </div>

      <section>
        <h2 className="mb-2 font-semibold">Events that did not confirm a booking</h2>
        {problems.length === 0 ? (
          <p className="text-muted rounded-xl border border-line bg-surface p-4 text-sm">
            Nothing to review. Every payment event matched a booking cleanly.
          </p>
        ) : (
          <ul className="space-y-2">
            {problems.map((p) => (
              <li key={p.id} className="rounded-xl border border-danger/30 bg-surface p-4 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">{p.eventType}</span>
                  <span className="text-muted text-xs">{formatLocalTime(p.receivedAt)}</span>
                </div>
                <p className="mt-1 text-danger">{p.error}</p>
                {p.bookingCode ? (
                  <p className="text-muted mt-1">
                    <Link
                      href={`/admin/bookings/${p.bookingCode}`}
                      className="font-mono text-brand underline"
                    >
                      {p.bookingCode}
                    </Link>{" "}
                    · booking is {p.bookingStatus} · expected {formatPaise(p.amountTotal ?? 0)}
                  </p>
                ) : (
                  <p className="text-muted mt-1">No matching booking in our system.</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8">
        <h2 className="mb-2 font-semibold">Still awaiting payment confirmation</h2>
        <p className="text-muted mb-3 text-sm">
          The reconciliation job re-checks these with the provider every two minutes. Anything
          lingering here was most likely abandoned at checkout.
        </p>
        {stuck.length === 0 ? (
          <p className="text-muted rounded-xl border border-line bg-surface p-4 text-sm">
            No bookings are stuck awaiting payment.
          </p>
        ) : (
          <ul className="space-y-2">
            {stuck.map((s) => (
              <li
                key={s.providerOrderId}
                className="flex flex-wrap items-baseline justify-between gap-2 rounded-xl border border-line bg-surface p-4 text-sm"
              >
                <div>
                  <Link
                    href={`/admin/bookings/${s.bookingCode}`}
                    className="font-mono font-semibold text-brand underline"
                  >
                    {s.bookingCode}
                  </Link>
                  <p className="text-muted mt-1 font-mono text-xs break-all">{s.providerOrderId}</p>
                </div>
                <div className="text-right">
                  <p className="font-medium">{formatPaise(s.amountTotal)}</p>
                  <p className="text-muted text-xs">{formatLocalTime(s.createdAt)}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
