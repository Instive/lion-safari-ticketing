import { eq } from "drizzle-orm";

import { db } from "@/db";
import { bookings, payments } from "@/db/schema";
import { env } from "@/lib/env";
import { writeAudit } from "../audit";
import { DomainError } from "../errors";
import { getPaymentProvider } from "./index";

/**
 * Prepares a checkout session for a PENDING online booking.
 *
 * Order of operations matters: the payment row is written BEFORE the provider
 * is called. If the provider call then fails, we have a recorded order id and
 * no way for money to move; the reverse order could take a customer's money for
 * an order we have no record of.
 */
export async function startOnlinePayment(bookingId: string): Promise<{
  orderId: string;
  checkoutPayload: Record<string, string>;
}> {
  const [booking] = await db.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1);
  if (!booking) throw new DomainError("NOT_FOUND", "We could not find that booking.");

  if (booking.status !== "PENDING") {
    throw new DomainError(
      "BOOKING_NOT_PAYABLE",
      "This booking is no longer awaiting payment.",
      `status=${booking.status}`,
    );
  }

  const provider = getPaymentProvider();
  // One order per booking. A failed payment means starting a new booking, which
  // keeps the money trail unambiguous.
  const orderId = `LS-${booking.bookingCode}`;

  await db
    .insert(payments)
    .values({
      bookingId: booking.id,
      provider: provider.name,
      providerOrderId: orderId,
      status: "PENDING",
      amount: booking.amountTotal,
      currency: booking.currency,
    })
    .onConflictDoNothing({ target: payments.providerOrderId });

  const result = await provider.createOrder({
    orderId,
    amountPaise: booking.amountTotal,
    currency: booking.currency,
    customer: {
      id: booking.bookingCode,
      name: booking.customerName,
      email: booking.customerEmail,
      phone: booking.customerPhone,
    },
    returnUrl: `${env.APP_BASE_URL}/ticket/${booking.bookingCode}`,
    idempotencyKey: orderId,
  });

  await writeAudit(db, {
    actor: { type: "CUSTOMER", id: booking.bookingCode },
    action: "payment.checkout_started",
    entity: "booking",
    entityId: booking.id,
    context: { orderId, provider: provider.name },
  });

  return { orderId, checkoutPayload: result.checkoutPayload };
}
