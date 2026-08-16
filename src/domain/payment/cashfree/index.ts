import { createHmac, timingSafeEqual } from "node:crypto";

import { env } from "@/lib/env";
import { paiseToRupeeString, rupeeStringToPaise } from "@/lib/money";
import type {
  CreateOrderInput,
  CreateOrderResult,
  NormalizedOrderStatus,
  NormalizedPaymentEvent,
  NormalizedRefund,
  PaymentProvider,
} from "../provider";

const API_VERSION = "2026-01-01";

function baseUrl(): string {
  return env.CASHFREE_ENV === "PRODUCTION"
    ? "https://api.cashfree.com/pg"
    : "https://sandbox.cashfree.com/pg";
}

function authHeaders(): Record<string, string> {
  return {
    "x-api-version": API_VERSION,
    "x-client-id": env.CASHFREE_APP_ID,
    "x-client-secret": env.CASHFREE_SECRET_KEY,
    "content-type": "application/json",
  };
}

async function call<T>(
  path: string,
  init: RequestInit & { idempotencyKey?: string } = {},
): Promise<T> {
  const { idempotencyKey, ...rest } = init;
  const res = await fetch(`${baseUrl()}${path}`, {
    ...rest,
    headers: {
      ...authHeaders(),
      ...(idempotencyKey ? { "x-idempotency-key": idempotencyKey } : {}),
      ...(rest.headers as Record<string, string> | undefined),
    },
    cache: "no-store",
  });

  const text = await res.text();
  if (!res.ok) {
    // Provider detail is logged upstream, never surfaced to the customer.
    throw new Error(`Cashfree ${path} failed: ${res.status} ${text.slice(0, 500)}`);
  }
  return JSON.parse(text) as T;
}

type CashfreeOrderResponse = {
  cf_order_id?: string | number;
  order_id: string;
  order_status?: string;
  payment_session_id: string;
  order_amount?: number;
  order_currency?: string;
};

type CashfreeWebhookBody = {
  type?: string;
  event_time?: string;
  data?: {
    order?: { order_id?: string; order_amount?: number; order_currency?: string };
    payment?: {
      cf_payment_id?: string | number;
      payment_status?: string;
      payment_amount?: number;
      payment_currency?: string;
    };
    refund?: {
      cf_refund_id?: string | number;
      refund_id?: string;
      refund_status?: string;
      refund_amount?: number;
      refund_currency?: string;
    };
  };
};

export class CashfreeProvider implements PaymentProvider {
  readonly name = "cashfree";

  async createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
    const body = {
      order_id: input.orderId,
      order_amount: Number(paiseToRupeeString(input.amountPaise)),
      order_currency: input.currency,
      customer_details: {
        customer_id: input.customer.id,
        customer_name: input.customer.name ?? undefined,
        customer_email: input.customer.email ?? undefined,
        customer_phone: input.customer.phone ?? "9999999999",
      },
      order_meta: { return_url: input.returnUrl },
    };

    let res: CashfreeOrderResponse;
    try {
      res = await call<CashfreeOrderResponse>("/orders", {
        method: "POST",
        body: JSON.stringify(body),
        idempotencyKey: input.idempotencyKey,
      });
    } catch (err) {
      // The customer reloaded checkout, or a retry reached us after the order
      // was already created. Reuse the existing order rather than minting a
      // second one for the same booking.
      const message = err instanceof Error ? err.message : String(err);
      if (!/already exists|duplicate/i.test(message)) throw err;

      res = await call<CashfreeOrderResponse>(`/orders/${encodeURIComponent(input.orderId)}`, {
        method: "GET",
      });
    }

    return {
      providerOrderId: res.order_id,
      checkoutPayload: {
        paymentSessionId: res.payment_session_id,
        mode: env.CASHFREE_ENV === "PRODUCTION" ? "production" : "sandbox",
      },
    };
  }

  /**
   * Signature = base64(HMAC-SHA256(timestamp + rawBody, clientSecret)).
   *
   * The raw body must be used exactly as received: parsing and re-serializing
   * JSON rewrites decimals (170.00 becomes 170) and breaks the signature.
   */
  verifyWebhook(rawBody: string, headers: Headers): NormalizedPaymentEvent | null {
    const signature = headers.get("x-webhook-signature");
    const timestamp = headers.get("x-webhook-timestamp");
    if (!signature || !timestamp || !env.CASHFREE_WEBHOOK_SECRET) return null;

    const expected = createHmac("sha256", env.CASHFREE_WEBHOOK_SECRET)
      .update(timestamp + rawBody)
      .digest("base64");

    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

    let parsed: CashfreeWebhookBody;
    try {
      parsed = JSON.parse(rawBody) as CashfreeWebhookBody;
    } catch {
      return null;
    }

    return normalizeEvent(parsed);
  }

  async fetchOrderStatus(orderId: string): Promise<NormalizedOrderStatus> {
    const res = await call<CashfreeOrderResponse>(`/orders/${encodeURIComponent(orderId)}`, {
      method: "GET",
    });

    const state: NormalizedOrderStatus["state"] =
      res.order_status === "PAID"
        ? "PAID"
        : res.order_status === "ACTIVE"
          ? "PENDING"
          : res.order_status === "EXPIRED"
            ? "EXPIRED"
            : res.order_status === "TERMINATED"
              ? "FAILED"
              : "UNKNOWN";

    // The order endpoint does not carry the payment id; reconciliation looks it
    // up separately only when it needs to record one.
    return {
      orderId: res.order_id,
      state,
      providerPaymentId: null,
      amountPaise: res.order_amount != null ? rupeeStringToPaise(res.order_amount) : null,
      currency: res.order_currency ?? null,
      raw: res,
    };
  }

  async refund(input: {
    orderId: string;
    providerPaymentId: string;
    amountPaise: number;
    refundId: string;
  }): Promise<NormalizedRefund> {
    const res = await call<{ cf_refund_id?: string | number; refund_status?: string }>(
      `/orders/${encodeURIComponent(input.orderId)}/refunds`,
      {
        method: "POST",
        body: JSON.stringify({
          refund_amount: Number(paiseToRupeeString(input.amountPaise)),
          refund_id: input.refundId,
          refund_note: "Lion Safari booking refund",
        }),
        idempotencyKey: input.refundId,
      },
    );

    return {
      providerRefundId: String(res.cf_refund_id ?? input.refundId),
      state:
        res.refund_status === "SUCCESS"
          ? "SUCCESS"
          : res.refund_status === "FAILED"
            ? "FAILED"
            : "PENDING",
      raw: res,
    };
  }
}

function normalizeEvent(body: CashfreeWebhookBody): NormalizedPaymentEvent | null {
  const type = body.type ?? "UNKNOWN";
  const orderId = body.data?.order?.order_id;
  if (!orderId) return null;

  if (type.startsWith("REFUND")) {
    const refund = body.data?.refund;
    const refundKey = String(refund?.cf_refund_id ?? refund?.refund_id ?? "unknown");
    return {
      providerEventId: `${type}:${refundKey}`,
      eventType: type,
      kind: refund?.refund_status === "SUCCESS" ? "REFUND_SUCCESS" : "UNKNOWN",
      orderId,
      providerPaymentId: null,
      amountPaise:
        refund?.refund_amount != null ? rupeeStringToPaise(refund.refund_amount) : null,
      currency: refund?.refund_currency ?? null,
      rawPayload: body,
    };
  }

  const payment = body.data?.payment;
  const paymentId = payment?.cf_payment_id != null ? String(payment.cf_payment_id) : null;

  const kind =
    payment?.payment_status === "SUCCESS"
      ? "PAYMENT_SUCCESS"
      : payment?.payment_status === "FAILED" || type.includes("USER_DROPPED")
        ? "PAYMENT_FAILED"
        : "UNKNOWN";

  return {
    // Deterministic: a retried delivery of the same payment event collapses onto
    // the same row and is processed exactly once.
    providerEventId: `${type}:${paymentId ?? orderId}`,
    eventType: type,
    kind,
    orderId,
    providerPaymentId: paymentId,
    amountPaise:
      payment?.payment_amount != null ? rupeeStringToPaise(payment.payment_amount) : null,
    currency: payment?.payment_currency ?? null,
    rawPayload: body,
  };
}
