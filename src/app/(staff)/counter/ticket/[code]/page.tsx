import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";

import { db } from "@/db";
import { bookings, tickets } from "@/db/schema";
import { TicketView } from "@/components/ticket-view";
import { requirePageStaff } from "@/lib/auth/guards";
import { businessDate } from "@/lib/time";
import { ClearDraftSaleKey } from "./clear-draft-sale-key";
import { PrintButton } from "./print-button";
import { VoidSaleForm } from "./void-sale-form";

export const metadata = { title: "Ticket — Lion Safari" };

/**
 * Print and reprint view. Reprinting re-renders the ticket that already exists;
 * it never creates a second booking or a second valid QR (spec §10).
 */
export default async function CounterTicketPage({
  params,
}: PageProps<"/counter/ticket/[code]">) {
  const staff = await requirePageStaff(["COUNTER"]);
  const { code } = await params;

  const [row] = await db
    .select({
      bookingCode: bookings.bookingCode,
      visitorCount: bookings.visitorCount,
      amountTotal: bookings.amountTotal,
      customerName: bookings.customerName,
      visitDate: bookings.visitDate,
      createdByStaffId: bookings.createdByStaffId,
      token: tickets.token,
      status: tickets.status,
      issuedAt: tickets.issuedAt,
    })
    .from(bookings)
    .innerJoin(tickets, eq(tickets.bookingId, bookings.id))
    .where(eq(bookings.bookingCode, code.toUpperCase()))
    .limit(1);

  if (!row) notFound();

  // Same eligibility the server action itself re-checks — computed here only
  // to decide whether to show the void affordance at all, never trusted as
  // the actual authorization (voidOwnSaleAction re-verifies independently).
  const canVoid =
    row.status === "ACTIVE" &&
    row.visitDate === businessDate() &&
    (staff.role === "ADMIN" || row.createdByStaffId === staff.id);

  // The ticket itself no longer prints a status badge (a "Valid" stamp on
  // paper only says what was true at print time), so this banner is where
  // staff read it — live, on screen, before handing anything over.
  const banner =
    row.status === "ACTIVE"
      ? {
          tone: "border-ok/30 bg-ok/5 text-ok",
          title: "Ticket ready — valid",
          note: "Hand this to the guest. Reprinting is safe — it is the same ticket.",
        }
      : row.status === "USED"
        ? {
            tone: "border-accent/40 bg-accent/5 text-accent",
            title: "Already used at the gate",
            note: "This group has boarded. Reprinting will not make it valid again.",
          }
        : {
            tone: "border-danger/30 bg-danger/5 text-danger",
            title: row.status === "CANCELLED" ? "Cancelled — not valid" : "Expired — not valid",
            note: "Do not hand this to a guest. Start a new sale if they still need entry.",
          };

  return (
    /*
      `print:block print:min-h-0` matters more than it looks: the full-height
      flex column below is what keeps the actions pinned to the bottom of the
      screen, and left in place at print time it would pad an 80mm thermal roll
      out to a viewport's worth of blank paper on every single ticket.
    */
    <main className="mx-auto flex min-h-dvh w-full max-w-4xl flex-col px-4 py-6 print:block print:min-h-0">
      <ClearDraftSaleKey />

      {/*
        Wide screens put the status beside the ticket rather than above it. A
        ticket is a tall, narrow thing; stacked, it pushed the status off the
        top of a counter display the moment staff scrolled to check the QR.

        Auto-placement does the reordering on its own: at `lg` the three
        children fall into (status, ticket, cancel) with the ticket spanning
        both rows, and below `lg` the same DOM order stacks as status → ticket
        → cancel — which is also the order that keeps a destructive action
        below the thing it destroys.
      */}
      <div className="flex flex-1 flex-col gap-5 lg:grid lg:grid-cols-[18rem_minmax(0,1fr)] lg:items-start lg:gap-8">
        <div className={`no-print rounded-xl border px-4 py-3 ${banner.tone}`}>
          <p className="font-semibold">{banner.title}</p>
          <p className="text-muted text-sm">{banner.note}</p>
        </div>

        <div className="mx-auto w-full max-w-md lg:row-span-2">
          <TicketView ticket={row} />
        </div>

        <div className="no-print">
          {canVoid ? <VoidSaleForm bookingCode={row.bookingCode} /> : null}
        </div>
      </div>

      {/* Pinned like the tender buttons on the sale screen: whatever staff have
          scrolled to, the way onward is under their thumb. */}
      <div className="no-print sticky bottom-0 z-10 -mx-4 mt-6 border-t border-line bg-background/95 px-4 pb-4 pt-3 backdrop-blur">
        <div className="mx-auto grid max-w-4xl grid-cols-2 gap-3">
          <PrintButton />
          <Link
            href="/counter"
            className="grid min-h-14 place-items-center rounded-xl bg-brand px-4 font-semibold text-white hover:bg-brand-strong"
          >
            Next sale
          </Link>
        </div>
      </div>
    </main>
  );
}
