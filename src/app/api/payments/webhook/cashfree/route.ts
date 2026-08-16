import { db } from "@/db";
import { writeAudit } from "@/domain/audit";
import { getPaymentProvider } from "@/domain/payment";
import { processPaymentEvent } from "@/domain/payment/process";
import { enqueueTicketDelivery } from "@/jobs/queue";

export const dynamic = "force-dynamic";
// Node runtime: signature verification needs node:crypto and the raw body.
export const runtime = "nodejs";

/**
 * Cashfree server-to-server webhook. This is the ONLY way an online booking
 * becomes PAID — the browser redirect proves nothing (spec §3.2, §4.1).
 *
 * Response contract with the provider:
 *   401 → bad signature, do not retry (we never processed it)
 *   200 → we own this event now, stop retrying
 *   500 → transient failure on our side, please retry
 */
export async function POST(req: Request): Promise<Response> {
  // Must be the raw text. Parsing to JSON and re-serializing rewrites decimals
  // and invalidates the signature.
  const rawBody = await req.text();

  const provider = getPaymentProvider("cashfree");
  const event = provider.verifyWebhook(rawBody, req.headers);

  if (!event) {
    // Logged to the audit trail rather than payment_events: an unverified caller
    // must not be able to insert rows keyed by an id it chose.
    await writeAudit(db, {
      actor: { type: "WEBHOOK" },
      action: "payment.webhook_rejected",
      entity: "payment_event",
      entityId: "unverified",
      context: {
        reason: "signature verification failed",
        bodyPreview: rawBody.slice(0, 200),
      },
    }).catch(() => {});

    return Response.json({ error: "invalid signature" }, { status: 401 });
  }

  try {
    const result = await processPaymentEvent("cashfree", event);

    if (result.status === "PROCESSED" && result.ticketId) {
      // Delivery is asynchronous and retryable; a failure here must not undo the
      // payment, so it is never allowed to fail the webhook.
      await enqueueTicketDelivery(result.bookingId).catch((err) => {
        console.error("[webhook] could not enqueue ticket delivery", err);
      });
    }

    return Response.json({ received: true, status: result.status });
  } catch (err) {
    console.error("[webhook] processing failed", err);
    // Ask the provider to retry — the transaction rolled back, so the event was
    // not consumed and reprocessing is safe.
    return Response.json({ error: "processing failed" }, { status: 500 });
  }
}
