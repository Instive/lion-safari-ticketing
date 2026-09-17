"use server";

import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db } from "@/db";
import { bookings, tickets } from "@/db/schema";
import { confirmBoarding } from "@/domain/boarding/confirm";
import { cancelBooking, refundOnlineBooking } from "@/domain/booking/refund";
import { DomainError } from "@/domain/errors";
import { enqueueTicketDelivery } from "@/jobs/queue";
import { requireStaff } from "@/lib/auth/guards";

export type AdminActionState = { error?: string; success?: string };

async function loadBooking(bookingCode: string) {
  const [booking] = await db
    .select()
    .from(bookings)
    .where(eq(bookings.bookingCode, bookingCode.toUpperCase()))
    .limit(1);
  return booking;
}

/** Cancels a booking and voids its ticket. Counter refunds are handled in cash. */
export async function cancelBookingAction(
  _prev: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  // Least privilege: only ADMIN may void tickets or move money (spec §12).
  const staff = await requireStaff(["ADMIN"]);
  const code = String(formData.get("bookingCode") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();

  if (reason.length < 3) return { error: "Please give a reason — it is recorded in the audit log." };

  const booking = await loadBooking(code);
  if (!booking) return { error: "Booking not found." };

  try {
    await cancelBooking(booking.id, { type: "STAFF", id: staff.id, name: staff.name }, reason);
    revalidatePath(`/admin/bookings/${booking.bookingCode}`);
    return { success: "Booking cancelled and ticket voided." };
  } catch (err) {
    if (err instanceof DomainError) return { error: err.userMessage };
    console.error("[admin] cancel failed", err);
    return { error: "Could not cancel this booking." };
  }
}

/** Starts a gateway refund for a paid online booking. */
export async function refundBookingAction(
  _prev: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const staff = await requireStaff(["ADMIN"]);
  const code = String(formData.get("bookingCode") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();

  if (reason.length < 3) return { error: "Please give a reason — it is recorded in the audit log." };

  const booking = await loadBooking(code);
  if (!booking) return { error: "Booking not found." };

  try {
    await refundOnlineBooking(
      booking.id,
      { type: "STAFF", id: staff.id, name: staff.name },
      reason,
    );
    revalidatePath(`/admin/bookings/${booking.bookingCode}`);
    return {
      success:
        "Refund requested. The ticket is cancelled now; the booking shows as refunded once the provider confirms.",
    };
  } catch (err) {
    if (err instanceof DomainError) return { error: err.userMessage };
    console.error("[admin] refund failed", err);
    return { error: "Could not start the refund." };
  }
}

/** Re-sends the existing ticket. Never issues a new one (spec §9). */
export async function resendTicketAction(
  _prev: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const staff = await requireStaff(["ADMIN", "COUNTER"]);
  const code = String(formData.get("bookingCode") ?? "");

  const booking = await loadBooking(code);
  if (!booking) return { error: "Booking not found." };
  if (!booking.customerEmail) return { error: "This booking has no email address on file." };

  try {
    await enqueueTicketDelivery(booking.id);
    console.info(`[admin] ${staff.username} re-sent ticket ${booking.bookingCode}`);
    return { success: `Ticket re-sent to ${booking.customerEmail}.` };
  } catch (err) {
    console.error("[admin] resend failed", err);
    return { error: "Could not queue the email. Please try again." };
  }
}

/**
 * Records a boarding from the admin portal, for when the gate scanner could not
 * do it — a flat battery, a torn QR, a device that would not come back online.
 *
 * Deliberately routed through the very same `confirmBoarding` the scanner
 * calls, rather than inserting a boarding event directly. That is what keeps
 * this from becoming a second, weaker way into the gate: the ticket is still
 * locked FOR UPDATE and re-validated as ACTIVE and for today, an already-used
 * ticket is still refused, and the group still boards all-or-nothing. The only
 * thing that differs is who is asking, which the audit trail records.
 */
export async function markBoardedAction(
  _prev: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  // Same privilege as voiding a ticket: this consumes one, and a ticket that
  // has been consumed cannot be used at the gate again.
  const staff = await requireStaff(["ADMIN"]);
  const code = String(formData.get("bookingCode") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();

  if (reason.length < 3) {
    return { error: "Please say why this is being recorded by hand — it is kept in the audit log." };
  }

  const booking = await loadBooking(code);
  if (!booking) return { error: "Booking not found." };

  const [ticket] = await db.select().from(tickets).where(eq(tickets.bookingId, booking.id)).limit(1);
  if (!ticket) return { error: "This booking has no ticket to board." };

  try {
    const result = await confirmBoarding({
      ticketId: ticket.id,
      // The whole group, exactly as sold: `confirmBoarding` refuses anything
      // else, and a manual entry is not a licence to admit a different number
      // of people than were paid for.
      boardedCount: ticket.visitorCount,
      // A fresh key per attempt. This is a person clicking a button, not a
      // queued device event being replayed, so there is nothing to deduplicate
      // against — and the ticket lock is what actually prevents a double
      // boarding if the button is clicked twice.
      clientEventId: randomUUID(),
      staffId: staff.id,
      actor: { type: "STAFF", id: staff.id, name: staff.name },
    });

    if (!result.ok) return { error: result.message };

    revalidatePath(`/admin/bookings/${booking.bookingCode}`);
    return {
      success: result.duplicate
        ? "This ticket was already recorded as boarded."
        : `Recorded ${ticket.visitorCount} visitor${ticket.visitorCount === 1 ? "" : "s"} as boarded.`,
    };
  } catch (err) {
    if (err instanceof DomainError) return { error: err.userMessage };
    console.error("[admin] manual boarding failed", err);
    return { error: "Could not record this boarding." };
  }
}
