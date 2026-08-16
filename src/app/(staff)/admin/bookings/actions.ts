"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db } from "@/db";
import { bookings } from "@/db/schema";
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
