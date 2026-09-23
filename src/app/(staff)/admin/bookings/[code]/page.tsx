import { and, desc, eq, or } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";

import { db } from "@/db";
import { auditLog, boardingEvents, bookings, payments, tickets } from "@/db/schema";
import { requirePageStaff } from "@/lib/auth/guards";
import { env } from "@/lib/env";
import { formatPaise } from "@/lib/money";
import { businessDate, formatLocalTime, formatVisitDate } from "@/lib/time";
import { StatusPill } from "../../status-pill";
import { BookingActions } from "./booking-actions";

export const metadata = { title: "Booking — Lion Safari" };
export const dynamic = "force-dynamic";

export default async function BookingDetailPage({
  params,
}: PageProps<"/admin/bookings/[code]">) {
  await requirePageStaff(["ADMIN"]);
  const { code } = await params;

  const [booking] = await db
    .select()
    .from(bookings)
    .where(eq(bookings.bookingCode, code.toUpperCase()))
    .limit(1);

  if (!booking) notFound();

  const [ticket] = await db.select().from(tickets).where(eq(tickets.bookingId, booking.id)).limit(1);
  const paymentRows = await db.select().from(payments).where(eq(payments.bookingId, booking.id));

  const boardings = ticket
    ? await db
        .select()
        .from(boardingEvents)
        .where(eq(boardingEvents.ticketId, ticket.id))
        .orderBy(desc(boardingEvents.boardedAt))
    : [];

  // The complete history for this booking and its ticket — spec §11 requires
  // operators to be able to see exactly what happened and who did it.
  const trail = await db
    .select()
    .from(auditLog)
    .where(
      or(
        and(eq(auditLog.entity, "booking"), eq(auditLog.entityId, booking.id)),
        ticket ? and(eq(auditLog.entity, "ticket"), eq(auditLog.entityId, ticket.id)) : undefined,
      ),
    )
    .orderBy(desc(auditLog.at))
    .limit(50);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6">
      <Link href="/admin/bookings" className="text-sm text-brand underline">
        ← All bookings
      </Link>

      <div className="mt-3 mb-6 flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="font-mono text-2xl font-bold tracking-wider">{booking.bookingCode}</h1>
        <StatusPill status={booking.status} ticketStatus={ticket?.status} />
      </div>

      {/*
        Straight to the ticket the guest is holding.

        Admin answers "is this person's ticket real, and what does it look like
        on their phone?" often enough that retyping a code into Find My Ticket
        is the wrong amount of work — and that form deliberately demands the
        booking code AND the phone number, which is exactly what an operator
        helping a guest over the counter may not have to hand.

        Only when there is a ticket to show: a PENDING or FAILED booking has no
        QR behind it, and a blank from a till's ticket book is not a sale (both
        now 404 on that page), so linking regardless would offer staff a dead
        end dressed up as an action.
      */}
      {ticket && booking.status !== "RESERVED" ? (
        <div className="mb-6 flex flex-wrap gap-2">
          <a
            href={customerTicketUrl(booking.bookingCode)}
            target="_blank"
            rel="noopener noreferrer"
            className="touch-target grid place-items-center rounded-xl border border-line bg-surface px-4 text-sm font-semibold hover:border-brand hover:text-brand"
          >
            Open guest ticket ↗
          </a>
          <Link
            href={`/counter/ticket/${booking.bookingCode}`}
            className="touch-target grid place-items-center rounded-xl border border-line bg-surface px-4 text-sm font-semibold hover:border-brand hover:text-brand"
          >
            Reprint at counter
          </Link>
        </div>
      ) : null}

      <section className="rounded-xl border border-line bg-surface p-5">
        <dl className="grid gap-3 sm:grid-cols-2">
          <Field label="Channel" value={booking.channel === "ONLINE" ? "Online" : "Counter (cash)"} />
          <Field label="Visit date" value={formatVisitDate(booking.visitDate)} />
          <Field label="Visitors" value={String(booking.visitorCount)} />
          <Field label="Amount" value={formatPaise(booking.amountTotal)} />
          {booking.convenienceFee > 0 ? (
            <Field label="Convenience fee" value={formatPaise(booking.convenienceFee)} />
          ) : null}
          <Field label="Created" value={formatLocalTime(booking.createdAt)} />
          <Field label="Guest" value={booking.customerName ?? "—"} />
          <Field label="Phone" value={booking.customerPhone ?? "—"} />
          <Field label="Email" value={booking.customerEmail ?? "—"} />
        </dl>
      </section>

      {paymentRows.length > 0 ? (
        <section className="mt-5">
          <h2 className="mb-2 font-semibold">Payments</h2>
          <div className="space-y-2">
            {paymentRows.map((p) => (
              <div key={p.id} className="rounded-xl border border-line bg-surface p-4 text-sm">
                <div className="flex flex-wrap justify-between gap-2">
                  <span className="font-medium">{p.provider}</span>
                  <span className="font-semibold">{p.status}</span>
                </div>
                <p className="text-muted mt-1 font-mono text-xs break-all">
                  order {p.providerOrderId}
                  {p.providerPaymentId ? ` · payment ${p.providerPaymentId}` : ""}
                </p>
                <p className="text-muted mt-1">{formatPaise(p.amount)}</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {boardings.length > 0 ? (
        <section className="mt-5">
          <h2 className="mb-2 font-semibold">Boarding</h2>
          {boardings.map((b) => (
            <div key={b.id} className="rounded-xl border border-line bg-surface p-4 text-sm">
              <p className="font-medium">
                {b.boardedCount} visitor{b.boardedCount === 1 ? "" : "s"} boarded
              </p>
              <p className="text-muted mt-1">
                {formatLocalTime(b.boardedAt)}
                {b.createdOffline ? " · recorded offline, synced later" : ""}
              </p>
            </div>
          ))}
        </section>
      ) : null}

      <BookingActions
        bookingCode={booking.bookingCode}
        status={booking.status}
        channel={booking.channel}
        hasEmail={Boolean(booking.customerEmail)}
        ticketStatus={ticket?.status}
        visitorCount={booking.visitorCount}
        isToday={booking.visitDate === businessDate()}
      />

      <section className="mt-8">
        <h2 className="mb-2 font-semibold">Audit trail</h2>
        <ol className="space-y-2">
          {trail.map((entry) => (
            <li key={entry.id} className="rounded-lg border border-line bg-surface px-4 py-3 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">{entry.action}</span>
                <span className="text-muted text-xs">{formatLocalTime(entry.at)}</span>
              </div>
              <p className="text-muted mt-1 text-xs">
                by {entry.actorType.toLowerCase()}
                {entry.actorId ? ` (${entry.actorId.slice(0, 8)})` : ""}
              </p>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}

/**
 * The guest-facing ticket page, as an absolute URL on the PUBLIC host.
 *
 * `/ticket/[code]` is a customer path, so `src/proxy.ts` 404s it on the staff
 * hostname by design — a relative <Link> from an admin page would land on the
 * wrong-host page whenever the two-domain split is deployed. Absolute, and a
 * plain <a> rather than next/link, because this deliberately leaves the staff
 * origin rather than client-navigating within it.
 *
 * With STAFF_BASE_URL unset (single-host local dev) both hosts are the same
 * origin and this is simply the same page.
 */
function customerTicketUrl(bookingCode: string): string {
  return new URL(`/ticket/${bookingCode}`, env.APP_BASE_URL).toString();
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted text-sm">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
