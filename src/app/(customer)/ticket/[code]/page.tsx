import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";

import { db } from "@/db";
import { bookings, tickets } from "@/db/schema";
import { TicketView } from "@/components/ticket-view";
import { clientIpFrom } from "@/lib/auth/session";
import { limitTicketLookup } from "@/lib/rate-limit";
import { env } from "@/lib/env";
import { PaymentPending } from "./payment-pending";

export const metadata = { title: "Your ticket — Chhatbir Zoo" };
export const dynamic = "force-dynamic";

/**
 * The customer's ticket, and the page the payment gateway returns them to.
 *
 * Critically, this page reads only OUR database. Coming back from the gateway
 * proves nothing — a booking shows as confirmed here only after the webhook (or
 * reconciliation) verified the payment server-side (spec §4.1).
 */
export default async function CustomerTicketPage({
  params,
}: PageProps<"/ticket/[code]">) {
  const { code } = await params;

  // Booking codes are the lookup key here, so this endpoint is the enumeration
  // surface and is rate limited per IP.
  const ip = clientIpFrom(await headers()) ?? "unknown";
  const limit = await limitTicketLookup(ip);
  if (!limit.allowed) {
    return (
      <Shell>
        <p className="rounded-xl border border-line bg-surface p-6 text-center">
          Too many requests. Please wait a moment and refresh.
        </p>
      </Shell>
    );
  }

  const [row] = await db
    .select({
      bookingCode: bookings.bookingCode,
      status: bookings.status,
      visitorCount: bookings.visitorCount,
      amountTotal: bookings.amountTotal,
      visitDate: bookings.visitDate,
      customerName: bookings.customerName,
      createdAt: bookings.createdAt,
      token: tickets.token,
      ticketStatus: tickets.status,
    })
    .from(bookings)
    .leftJoin(tickets, eq(tickets.bookingId, bookings.id))
    .where(eq(bookings.bookingCode, code.toUpperCase()))
    .limit(1);

  if (!row) notFound();

  if (row.status === "PENDING") {
    return (
      <Shell>
        <PaymentPending bookingCode={row.bookingCode} />
      </Shell>
    );
  }

  if (row.status === "FAILED" || row.status === "CANCELLED") {
    return (
      <Shell>
        <div className="rounded-xl border border-danger/30 bg-surface p-6 text-center">
          <h1 className="text-lg font-semibold text-danger">
            {row.status === "FAILED" ? "Payment was not completed" : "Booking cancelled"}
          </h1>
          <p className="text-muted mt-2 text-sm">
            {row.status === "FAILED"
              ? "No ticket was issued and you have not been charged. If money was deducted, it is automatically returned by your bank."
              : "This booking was cancelled. Any refund due is processed to your original payment method."}
          </p>
          <Link
            href="/book"
            className="touch-target mt-5 grid place-items-center rounded-xl bg-brand font-semibold text-white hover:bg-brand-strong"
          >
            Book again
          </Link>
          {env.SUPPORT_PHONE ? (
            <p className="text-muted mt-4 text-xs">Need help? Call {env.SUPPORT_PHONE}</p>
          ) : null}
        </div>
      </Shell>
    );
  }

  if (!row.token || !row.ticketStatus) {
    // Confirmed but the ticket row is a moment behind; it is being issued.
    return (
      <Shell>
        <PaymentPending bookingCode={row.bookingCode} />
      </Shell>
    );
  }

  return (
    <Shell>
      <TicketView
        ticket={{
          bookingCode: row.bookingCode,
          token: row.token,
          status: row.ticketStatus,
          visitorCount: row.visitorCount,
          visitDate: row.visitDate,
          amountTotal: row.amountTotal,
          customerName: row.customerName,
        }}
      />
      <p className="text-muted no-print mt-4 text-center text-xs">
        Save this page or check your email. You can find it again from the home page.
      </p>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto w-full max-w-md px-4 py-8">{children}</main>;
}
