"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { businessDate } from "@/lib/time";
import { createCounterBooking } from "@/domain/booking/create";
import { MAX_VISITORS_PER_BOOKING, type RateSelection } from "@/domain/booking/pricing";
import { cancelBooking } from "@/domain/booking/refund";
import { DomainError, ForbiddenError } from "@/domain/errors";
import { requireStaff } from "@/lib/auth/guards";
import { rupeeStringToPaise } from "@/lib/money";
import { db } from "@/db";
import { bookings, tickets } from "@/db/schema";
import { eq } from "drizzle-orm";

const schema = z.object({
  visitorCount: z.coerce.number().int().min(1).max(MAX_VISITORS_PER_BOOKING),
  /** Minted in the browser when the sale screen loaded; makes a double-tap safe. */
  idempotencyKey: z.uuid(),
  // Name and phone are a convenience for later lookup, not load-bearing —
  // a formatting quirk here must never be the reason a cash sale fails. Only
  // length is capped; nothing about their shape is validated.
  customerName: z.string().trim().max(120).optional(),
  customerPhone: z.string().trim().max(20).optional(),

  /**
   * How the sale was priced. Note what is NOT here: an amount. A category is
   * named by id and priced from its row; a one-off price is bounded and must be
   * explained. `resolveRate` enforces both — this only shapes the request.
   */
  rateKind: z.enum(["STANDARD", "CATEGORY", "CUSTOM"]).default("STANDARD"),
  rateCategoryId: z.uuid().optional(),
  /** Whole rupees as typed at the counter; converted to paise before it moves. */
  customRateRupees: z.coerce.number().min(0).max(1_000_000).optional(),
  rateNote: z.string().trim().max(200).optional(),
});

/** Shapes the validated form into the rate the domain will price. */
function rateFrom(parsed: z.infer<typeof schema>): RateSelection {
  if (parsed.rateKind === "CATEGORY" && parsed.rateCategoryId) {
    return { kind: "CATEGORY", categoryId: parsed.rateCategoryId };
  }
  if (parsed.rateKind === "CUSTOM") {
    return {
      kind: "CUSTOM",
      perVisitorPaise: rupeeStringToPaise(parsed.customRateRupees ?? 0),
      note: parsed.rateNote ?? "",
    };
  }
  return { kind: "STANDARD" };
}

export type CashSaleState = { error?: string };

/**
 * Counter cash sale. The booking is created already CASH_CONFIRMED and its
 * ticket is issued in the same transaction — the staff member is holding the
 * money, so there is no in-between state to recover from.
 */
export async function createCashSaleAction(
  _prev: CashSaleState,
  formData: FormData,
): Promise<CashSaleState> {
  let staff;
  try {
    staff = await requireStaff(["COUNTER"]);
  } catch (err) {
    if (err instanceof ForbiddenError) {
      // A session that expired mid-shift must not read as a crash: the
      // visitor count staff already entered is still in the browser, so
      // signing back in and resubmitting is a one-step recovery, not a redo.
      redirect("/login?expired=1");
    }
    throw err;
  }

  const parsed = schema.safeParse({
    visitorCount: formData.get("visitorCount"),
    idempotencyKey: formData.get("idempotencyKey"),
    customerName: formData.get("customerName") ?? undefined,
    customerPhone: formData.get("customerPhone") ?? undefined,
    rateKind: formData.get("rateKind") ?? undefined,
    rateCategoryId: formData.get("rateCategoryId") || undefined,
    customRateRupees: formData.get("customRateRupees") || undefined,
    rateNote: formData.get("rateNote") ?? undefined,
  });

  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    if (issue?.path[0] === "visitorCount") {
      return { error: "Please choose how many visitors are boarding." };
    }
    // Anything else (a malformed idempotency key, an over-long name) is our
    // bug, not staff's — say so plainly rather than pointing at the count.
    return { error: "Something about this sale didn't go through. Please try again." };
  }

  let bookingCode: string;
  try {
    const result = await createCounterBooking({
      visitorCount: parsed.data.visitorCount,
      customerName: parsed.data.customerName || null,
      customerPhone: parsed.data.customerPhone || null,
      idempotencyKey: parsed.data.idempotencyKey,
      createdByStaffId: staff.id,
      rate: rateFrom(parsed.data),
      actor: { type: "STAFF", id: staff.id, name: staff.name },
    });
    bookingCode = result.booking.bookingCode;
  } catch (err) {
    if (err instanceof DomainError) return { error: err.userMessage };
    // Technical detail is logged, never shown (spec §17).
    console.error("[counter] cash sale failed", err);
    return {
      error: "Could not reach the ticketing system. Check the connection and try again.",
    };
  }

  redirect(`/counter/ticket/${bookingCode}`);
}

export type VoidSaleState = { error?: string; voided?: boolean };

/**
 * Lets counter staff undo a mistake they JUST made — a mis-keyed visitor
 * count is the common case — without waiting for an admin.
 *
 * Deliberately narrow, unlike the admin cancel/refund path: only the sale's
 * own creator, only the same business day, and only before the ticket has
 * been used at the gate. Wide enough to fix a typo on the spot, narrow enough
 * that it can't be used to quietly make an already-boarded sale disappear.
 */
export async function voidOwnSaleAction(
  _prev: VoidSaleState,
  formData: FormData,
): Promise<VoidSaleState> {
  const staff = await requireStaff(["COUNTER"]);
  const bookingCode = String(formData.get("bookingCode") ?? "").toUpperCase();
  const reason = String(formData.get("reason") ?? "").trim();

  if (reason.length < 3) {
    return { error: "Please say what went wrong — it's recorded with the void." };
  }

  const [row] = await db
    .select({
      bookingId: bookings.id,
      createdByStaffId: bookings.createdByStaffId,
      visitDate: bookings.visitDate,
      status: bookings.status,
      ticketStatus: tickets.status,
    })
    .from(bookings)
    .innerJoin(tickets, eq(tickets.bookingId, bookings.id))
    .where(eq(bookings.bookingCode, bookingCode))
    .limit(1);

  if (!row) return { error: "We could not find that sale." };
  if (staff.role !== "ADMIN" && row.createdByStaffId !== staff.id) {
    return { error: "You can only void a sale you personally created." };
  }
  if (row.visitDate !== businessDate()) {
    return { error: "This sale is from an earlier day — ask an admin to cancel it." };
  }
  if (row.ticketStatus !== "ACTIVE") {
    return {
      error:
        row.ticketStatus === "USED"
          ? "This ticket has already been used at the gate and can't be voided."
          : "This sale has already been voided or cancelled.",
    };
  }

  try {
    await cancelBooking(
      row.bookingId,
      { type: "STAFF", id: staff.id, name: staff.name },
      `Voided at counter: ${reason}`,
    );
  } catch (err) {
    if (err instanceof DomainError) return { error: err.userMessage };
    console.error("[counter] void sale failed", err);
    return { error: "Could not void this sale. Please try again." };
  }

  // The ticket page above rendered pre-void data; revalidate so it reflects
  // the now-cancelled ticket instead of leaving a stale "valid" QR on screen.
  revalidatePath(`/counter/ticket/${bookingCode}`);
  return { voided: true };
}
