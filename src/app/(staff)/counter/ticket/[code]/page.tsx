import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";

import { db } from "@/db";
import { bookings, tickets } from "@/db/schema";
import { TicketView } from "@/components/ticket-view";
import { requirePageStaff } from "@/lib/auth/guards";
import { PrintButton } from "./print-button";

export const metadata = { title: "Ticket — Lion Safari" };

/**
 * Print and reprint view. Reprinting re-renders the ticket that already exists;
 * it never creates a second booking or a second valid QR (spec §10).
 */
export default async function CounterTicketPage({
  params,
}: PageProps<"/counter/ticket/[code]">) {
  await requirePageStaff(["COUNTER"]);
  const { code } = await params;

  const [row] = await db
    .select({
      bookingCode: bookings.bookingCode,
      visitorCount: bookings.visitorCount,
      amountTotal: bookings.amountTotal,
      customerName: bookings.customerName,
      visitDate: bookings.visitDate,
      token: tickets.token,
      status: tickets.status,
    })
    .from(bookings)
    .innerJoin(tickets, eq(tickets.bookingId, bookings.id))
    .where(eq(bookings.bookingCode, code.toUpperCase()))
    .limit(1);

  if (!row) notFound();

  return (
    <main className="mx-auto w-full max-w-md px-4 py-6">
      <div className="no-print mb-4 rounded-xl border border-ok/30 bg-ok/5 px-4 py-3">
        <p className="font-semibold text-ok">Ticket ready</p>
        <p className="text-muted text-sm">
          Hand this to the guest. Reprinting is safe — it is the same ticket.
        </p>
      </div>

      <TicketView ticket={row} />

      <div className="no-print mt-5 grid grid-cols-2 gap-3">
        <PrintButton />
        <Link
          href="/counter"
          className="touch-target grid place-items-center rounded-xl bg-brand px-4 font-semibold text-white hover:bg-brand-strong"
        >
          Next sale
        </Link>
      </div>
    </main>
  );
}
