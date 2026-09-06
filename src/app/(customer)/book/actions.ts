"use server";

import { z } from "zod";

import { createOnlineBooking } from "@/domain/booking/create";
import { MAX_VISITORS_PER_BOOKING } from "@/domain/booking/pricing";
import { assertBookableVisitDate } from "@/domain/booking/visit-date";
import { DomainError } from "@/domain/errors";
import { startOnlinePayment } from "@/domain/payment/start";
import { paymentsConfigured } from "@/lib/env";

const schema = z.object({
  visitorCount: z.coerce.number().int().min(1).max(MAX_VISITORS_PER_BOOKING),
  customerName: z.string().trim().min(1, "name required").max(120),
  customerPhone: z
    .string()
    .trim()
    .regex(/^[0-9]{10}$/, "10-digit phone required"),
  customerEmail: z.email().max(200),
  /**
   * The day the guest is coming. Range and closed-day rules are enforced by
   * `assertBookableVisitDate` below, not here, so one module owns them.
   */
  visitDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "visit date required"),
  /** Minted when the form was rendered — a double-tap reuses it. */
  idempotencyKey: z.uuid(),
});

export type BookingState = {
  error?: string;
  checkout?: { paymentSessionId: string; mode: string; bookingCode: string };
};

/**
 * Creates a PENDING booking and opens a checkout session.
 *
 * Note what this does NOT do: it does not confirm anything. The amount comes
 * from the server-side quote, and the booking stays PENDING until the payment
 * webhook is verified (spec §3.2).
 */
export async function startBookingAction(
  _prev: BookingState,
  formData: FormData,
): Promise<BookingState> {
  if (!paymentsConfigured()) {
    return { error: "Online booking is temporarily unavailable. Please book at the counter." };
  }

  const parsed = schema.safeParse({
    visitorCount: formData.get("visitorCount"),
    customerName: formData.get("customerName"),
    customerPhone: formData.get("customerPhone"),
    customerEmail: formData.get("customerEmail"),
    visitDate: formData.get("visitDate"),
    idempotencyKey: formData.get("idempotencyKey"),
  });

  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { error: friendlyFieldError(first?.path[0]) };
  }

  try {
    // Re-checked server-side: the input's min/max and disabled closed days are
    // a convenience for the browser, never the rule.
    assertBookableVisitDate(parsed.data.visitDate);

    const { booking } = await createOnlineBooking({
      visitorCount: parsed.data.visitorCount,
      visitDate: parsed.data.visitDate,
      customerName: parsed.data.customerName,
      customerPhone: parsed.data.customerPhone,
      customerEmail: parsed.data.customerEmail,
      idempotencyKey: parsed.data.idempotencyKey,
      actor: { type: "CUSTOMER" },
    });

    const { checkoutPayload } = await startOnlinePayment(booking.id);

    return {
      checkout: {
        paymentSessionId: checkoutPayload.paymentSessionId!,
        mode: checkoutPayload.mode!,
        bookingCode: booking.bookingCode,
      },
    };
  } catch (err) {
    if (err instanceof DomainError) return { error: err.userMessage };
    console.error("[book] could not start booking", err);
    return { error: "We could not start your booking. Please try again." };
  }
}

function friendlyFieldError(field: unknown): string {
  switch (field) {
    case "customerName":
      return "Please enter your name.";
    case "customerPhone":
      return "Please enter a valid 10-digit mobile number.";
    case "customerEmail":
      return "Please enter a valid email address — your ticket is sent there.";
    case "visitorCount":
      return "Please choose at least one visitor.";
    case "visitDate":
      return "Please choose the date you are visiting.";
    default:
      return "Please check your details and try again.";
  }
}
