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
    <main className="mx-auto w-full max-w-md px-4 py-6">
      <ClearDraftSaleKey />
      <div className={`no-print mb-4 rounded-xl border px-4 py-3 ${banner.tone}`}>
        <p className="font-semibold">{banner.title}</p>
        <p className="text-muted text-sm">{banner.note}</p>
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

      {canVoid ? <VoidSaleForm bookingCode={row.bookingCode} /> : null}
    </main>
  );
}
