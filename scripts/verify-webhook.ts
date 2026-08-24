/**
 * Exercises the payment webhook against a running dev server — the failure
 * scenarios from spec §14 that matter most:
 *
 *   duplicate webhook · tampered signature · unsigned request · wrong amount
 *
 * Usage: npm run verify:webhook   (dev server must be running)
 */
import { createHmac, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";

import { db, pool } from "@/db";
import { bookings, payments, tickets } from "@/db/schema";
import { createOnlineBooking } from "@/domain/booking/create";
import { env } from "@/lib/env";
import { paiseToRupeeString } from "@/lib/money";
import { assertNotProduction } from "./lib/guard";

const BASE = env.APP_BASE_URL;
const WEBHOOK_URL = `${BASE}/api/payments/webhook/cashfree`;

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}${detail ? ` — ${detail}` : ""}`);
}

/** Builds a Cashfree-shaped payload and signs it the way Cashfree does. */
function signedWebhook(opts: {
  orderId: string;
  amountPaise: number;
  paymentId: string;
  status?: string;
  type?: string;
  secret?: string;
}) {
  const body = JSON.stringify({
    type: opts.type ?? "PAYMENT_SUCCESS_WEBHOOK",
    event_time: new Date().toISOString(),
    data: {
      order: {
        order_id: opts.orderId,
        order_amount: Number(paiseToRupeeString(opts.amountPaise)),
        order_currency: "INR",
      },
      payment: {
        cf_payment_id: opts.paymentId,
        payment_status: opts.status ?? "SUCCESS",
        payment_amount: Number(paiseToRupeeString(opts.amountPaise)),
        payment_currency: "INR",
        payment_group: "upi",
      },
      customer_details: { customer_id: "test", customer_email: "test@example.com" },
    },
  });

  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", opts.secret ?? env.CASHFREE_WEBHOOK_SECRET)
    .update(timestamp + body)
    .digest("base64");

  return { body, timestamp, signature };
}

function post(payload: { body: string; timestamp: string; signature: string }) {
  return fetch(WEBHOOK_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-webhook-signature": payload.signature,
      "x-webhook-timestamp": payload.timestamp,
    },
    body: payload.body,
  });
}

async function makePendingBooking(visitorCount: number) {
  const { booking } = await createOnlineBooking({
    visitorCount,
    customerName: "Webhook Test",
    customerPhone: "9999999999",
    customerEmail: "webhook-test@example.com",
    idempotencyKey: `verify-wh-${randomUUID()}`,
    actor: { type: "CUSTOMER" },
  });

  const orderId = `LS-${booking.bookingCode}`;
  await db.insert(payments).values({
    bookingId: booking.id,
    provider: "cashfree",
    providerOrderId: orderId,
    status: "PENDING",
    amount: booking.amountTotal,
    currency: booking.currency,
  });

  return { booking, orderId };
}

async function statusOf(bookingId: string) {
  const [row] = await db
    .select({ status: bookings.status })
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .limit(1);
  return row!.status;
}

async function ticketCount(bookingId: string) {
  const rows = await db.select().from(tickets).where(eq(tickets.bookingId, bookingId));
  return rows.length;
}

async function main() {
  assertNotProduction("run the webhook checks");
  console.log(`Testing webhook at ${WEBHOOK_URL}\n`);

  // ---------------------------------------------------------------------
  console.log("1. A valid signed webhook confirms the booking and issues one ticket");
  const a = await makePendingBooking(3);
  check("booking starts PENDING", (await statusOf(a.booking.id)) === "PENDING");

  const paymentId = `cfpay_${randomUUID().slice(0, 12)}`;
  const good = signedWebhook({
    orderId: a.orderId,
    amountPaise: a.booking.amountTotal,
    paymentId,
  });

  const res1 = await post(good);
  const body1 = (await res1.json()) as { status?: string };
  check("responds 200", res1.status === 200, `got ${res1.status}`);
  check("reports PROCESSED", body1.status === "PROCESSED", String(body1.status));
  check("booking is now PAID", (await statusOf(a.booking.id)) === "PAID");
  check("exactly one ticket issued", (await ticketCount(a.booking.id)) === 1);

  // ---------------------------------------------------------------------
  console.log("\n2. The SAME webhook replayed does not issue a second ticket");
  const res2 = await post(good);
  const body2 = (await res2.json()) as { status?: string };
  check("responds 200", res2.status === 200, `got ${res2.status}`);
  check("reports DUPLICATE", body2.status === "DUPLICATE", String(body2.status));
  check("still exactly one ticket", (await ticketCount(a.booking.id)) === 1);

  // A re-delivery with a fresh signature but the same payment is still one event.
  const resigned = signedWebhook({
    orderId: a.orderId,
    amountPaise: a.booking.amountTotal,
    paymentId,
  });
  const res3 = await post(resigned);
  const body3 = (await res3.json()) as { status?: string };
  check("re-signed re-delivery is DUPLICATE", body3.status === "DUPLICATE", String(body3.status));
  check("still exactly one ticket", (await ticketCount(a.booking.id)) === 1);

  // ---------------------------------------------------------------------
  console.log("\n3. A tampered payload is rejected");
  const b = await makePendingBooking(2);
  const legit = signedWebhook({
    orderId: b.orderId,
    amountPaise: b.booking.amountTotal,
    paymentId: `cfpay_${randomUUID().slice(0, 12)}`,
  });
  // Same signature, body swapped for a bigger amount.
  const tampered = {
    ...legit,
    body: legit.body.replace(/"payment_amount":\s*[0-9.]+/, '"payment_amount": 1'),
  };
  const res4 = await post(tampered);
  check("responds 401", res4.status === 401, `got ${res4.status}`);
  check("booking still PENDING", (await statusOf(b.booking.id)) === "PENDING");
  check("no ticket issued", (await ticketCount(b.booking.id)) === 0);

  // ---------------------------------------------------------------------
  console.log("\n4. A webhook signed with the wrong secret is rejected");
  const forged = signedWebhook({
    orderId: b.orderId,
    amountPaise: b.booking.amountTotal,
    paymentId: `cfpay_${randomUUID().slice(0, 12)}`,
    secret: "attacker-guessed-secret",
  });
  const res5 = await post(forged);
  check("responds 401", res5.status === 401, `got ${res5.status}`);
  check("booking still PENDING", (await statusOf(b.booking.id)) === "PENDING");

  // ---------------------------------------------------------------------
  console.log("\n5. An unsigned webhook is rejected");
  const res6 = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: legit.body,
  });
  check("responds 401", res6.status === 401, `got ${res6.status}`);
  check("booking still PENDING", (await statusOf(b.booking.id)) === "PENDING");
  check("no ticket issued", (await ticketCount(b.booking.id)) === 0);

  // ---------------------------------------------------------------------
  console.log("\n6. A correctly signed webhook for the WRONG amount does not confirm");
  const c = await makePendingBooking(4);
  const underpaid = signedWebhook({
    orderId: c.orderId,
    // Properly signed, but only a fraction of what is owed.
    amountPaise: 100,
    paymentId: `cfpay_${randomUUID().slice(0, 12)}`,
  });
  const res7 = await post(underpaid);
  const body7 = (await res7.json()) as { status?: string };
  check("responds 200 (event consumed)", res7.status === 200, `got ${res7.status}`);
  check("reports MISMATCH", body7.status === "MISMATCH", String(body7.status));
  check("booking still PENDING — not confirmed", (await statusOf(c.booking.id)) === "PENDING");
  check("no ticket issued", (await ticketCount(c.booking.id)) === 0);

  // ---------------------------------------------------------------------
  console.log("\n7. A failed-payment webhook marks the booking FAILED, issues nothing");
  const d = await makePendingBooking(2);
  const failed = signedWebhook({
    orderId: d.orderId,
    amountPaise: d.booking.amountTotal,
    paymentId: `cfpay_${randomUUID().slice(0, 12)}`,
    status: "FAILED",
    type: "PAYMENT_FAILED_WEBHOOK",
  });
  const res8 = await post(failed);
  check("responds 200", res8.status === 200, `got ${res8.status}`);
  check("booking is FAILED", (await statusOf(d.booking.id)) === "FAILED");
  check("no ticket issued", (await ticketCount(d.booking.id)) === 0);

  console.log(
    failures === 0
      ? "\nAll webhook failure scenarios behaved correctly.\n"
      : `\n${failures} check(s) FAILED.\n`,
  );
  if (failures > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
