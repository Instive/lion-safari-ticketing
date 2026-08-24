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
      `print:block print:min-h-0` is load-bearing, not tidiness: the full-height
      flex column is what pins the actions to the bottom of the screen, and left
      in place at print time it pads an 80mm thermal roll out to a viewport's
      worth of blank paper on every single ticket.
    */
    <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-4 py-6 print:block print:min-h-0">
      <ClearDraftSaleKey />

      {/*
        Three columns, with the third left empty on purpose: it is what keeps
        the ticket centred on the screen rather than shunted right by the status
        panel beside it. A ticket is the thing being handed over, so it stays
        where the eye already expects it, and the status moves into the space
        that was previously blank.

        Below `lg` the grid collapses and DOM order takes over: status → ticket
        → cancel.
      */}
      <div className="flex flex-1 flex-col gap-5 lg:grid lg:grid-cols-[1fr_auto_1fr] lg:items-start lg:gap-6">
        <div
          className={`no-print rounded-xl border px-4 py-3 lg:col-start-1 lg:max-w-72 lg:justify-self-end ${banner.tone}`}
        >
          <p className="font-semibold">{banner.title}</p>
          <p className="text-muted text-sm">{banner.note}</p>
        </div>

        <div className="mx-auto w-full max-w-md lg:col-start-2">
          <TicketView ticket={row} />

          {/* Directly under the ticket, because that is the thing it acts on —
              and far enough from the pinned bar below that the destructive
              button is never the one under a thumb reaching for "Next sale". */}
          {canVoid ? <VoidSaleForm bookingCode={row.bookingCode} /> : null}
        </div>
      </div>

      {/* Pinned like the tender buttons on the sale screen: however far staff
          have scrolled down a tall ticket, the way onward stays under their
          thumb. Sticky elements keep their space in flow, so nothing is hidden
          behind this and the content needs no extra padding. */}
      <div className="no-print sticky bottom-0 z-10 -mx-4 mt-6 border-t border-line bg-background/95 px-4 pb-4 pt-3 backdrop-blur">
        <div className="mx-auto grid max-w-md grid-cols-2 gap-3">
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
