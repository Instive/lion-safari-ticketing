import { and, eq, gt, lt } from "drizzle-orm";

import { db } from "@/db";
import { bookings, payments } from "@/db/schema";
import { writeAudit } from "@/domain/audit";
import { getPaymentProvider } from "@/domain/payment";
import { processPaymentEvent } from "@/domain/payment/process";
import { transitionBooking } from "@/domain/booking/status";
import { env } from "@/lib/env";
import { enqueueTicketDelivery } from "../queue";

/** Beyond this, the checkout session is long gone. */
const MAX_AGE_HOURS = 24;

/**
 * The safety net for lost webhooks (spec §4.2).
 *
 * A customer whose payment succeeded but whose webhook never reached us would
 * otherwise sit at PENDING forever with money taken. This job asks the provider
 * directly and routes the answer through the very same processing path as a
 * webhook, so every guarantee — amount checking, idempotency, audit — still
 * applies.
 */
export async function reconcilePayments(): Promise<{ checked: number; confirmed: number }> {
  const provider = getPaymentProvider();
  const now = Date.now();

  const stale = await db
    .select({
      bookingId: bookings.id,
      bookingCode: bookings.bookingCode,
      providerOrderId: payments.providerOrderId,
    })
    .from(bookings)
    .innerJoin(payments, eq(payments.bookingId, bookings.id))
    .where(
      and(
        eq(bookings.status, "PENDING"),
        eq(bookings.channel, "ONLINE"),
        // Give the webhook a fair chance to arrive before we go asking.
        lt(bookings.createdAt, new Date(now - env.RECONCILE_MIN_AGE_MINUTES * 60_000)),
        gt(bookings.createdAt, new Date(now - MAX_AGE_HOURS * 3_600_000)),
      ),
    )
    .limit(100);

  let confirmed = 0;

  for (const row of stale) {
    try {
      const status = await provider.fetchOrderStatus(row.providerOrderId);

      if (status.state === "PAID") {
        // Deterministic event id: re-running reconciliation is idempotent, and
        // it cannot collide with the provider's own webhook event ids.
        const result = await processPaymentEvent(provider.name, {
          providerEventId: `RECONCILE:${row.providerOrderId}`,
          eventType: "RECONCILIATION_ORDER_PAID",
          kind: "PAYMENT_SUCCESS",
          orderId: row.providerOrderId,
          providerPaymentId: status.providerPaymentId,
          amountPaise: status.amountPaise,
          currency: status.currency,
          rawPayload: status.raw,
        });

        if (result.status === "PROCESSED") {
          confirmed++;
          await enqueueTicketDelivery(row.bookingId).catch(() => {});
          console.info(`[reconcile] recovered ${row.bookingCode} — webhook never arrived`);
        } else if (result.status === "MISMATCH") {
          console.error(`[reconcile] AMOUNT MISMATCH on ${row.bookingCode}: ${result.detail}`);
        }
      } else if (status.state === "EXPIRED" || status.state === "FAILED") {
        await db.transaction(async (tx) => {
          await transitionBooking(tx, row.bookingId, "FAILED", {
            type: "SYSTEM",
            id: "reconcile",
          });
        });
      }
    } catch (err) {
      // One bad order must not stop the sweep.
      console.error(`[reconcile] could not check ${row.bookingCode}`, err);
      await writeAudit(db, {
        actor: { type: "SYSTEM", id: "reconcile" },
        action: "payment.reconcile_failed",
        entity: "booking",
        entityId: row.bookingId,
        context: { message: err instanceof Error ? err.message : String(err) },
      }).catch(() => {});
    }
  }

  return { checked: stale.length, confirmed };
}
