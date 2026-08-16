/**
 * The seam that keeps Cashfree replaceable.
 *
 * Everything outside `src/domain/payment/<provider>/` speaks only in the
 * normalized shapes below. Swapping to Razorpay later means adding one folder
 * and changing the factory in `./index.ts` — no changes to booking, ticket or
 * webhook-processing logic.
 */

export type CreateOrderInput = {
  /** Our order id, unique per payment attempt. Sent to the provider verbatim. */
  orderId: string;
  amountPaise: number;
  currency: string;
  customer: {
    id: string;
    name?: string | null;
    email?: string | null;
    phone?: string | null;
  };
  returnUrl: string;
  /** Provider-level idempotency for order creation, where supported. */
  idempotencyKey: string;
};

export type CreateOrderResult = {
  providerOrderId: string;
  /**
   * Opaque payload the browser needs to open the provider's hosted checkout.
   * Contains no secret: it authorizes paying this one order, nothing else.
   */
  checkoutPayload: Record<string, string>;
};

export type NormalizedEventKind =
  | "PAYMENT_SUCCESS"
  | "PAYMENT_FAILED"
  | "REFUND_SUCCESS"
  | "UNKNOWN";

export type NormalizedPaymentEvent = {
  /**
   * Stable, deterministic id for this event. A provider retry of the same event
   * must produce the SAME id — that is what makes webhook processing idempotent
   * via the unique constraint on payment_events.provider_event_id.
   */
  providerEventId: string;
  /** Provider's own type string, kept for the audit log. */
  eventType: string;
  kind: NormalizedEventKind;
  /** Our order id, as echoed back by the provider. */
  orderId: string;
  providerPaymentId: string | null;
  amountPaise: number | null;
  currency: string | null;
  rawPayload: unknown;
};

export type NormalizedOrderStatus = {
  orderId: string;
  /** PAID means the provider considers this order settled. */
  state: "PAID" | "PENDING" | "FAILED" | "EXPIRED" | "UNKNOWN";
  providerPaymentId: string | null;
  amountPaise: number | null;
  currency: string | null;
  raw: unknown;
};

export type NormalizedRefund = {
  providerRefundId: string;
  state: "PENDING" | "SUCCESS" | "FAILED";
  raw: unknown;
};

export interface PaymentProvider {
  readonly name: string;

  createOrder(input: CreateOrderInput): Promise<CreateOrderResult>;

  /**
   * Verifies authenticity from the RAW request body and returns the normalized
   * event, or null when the signature is missing or wrong. Callers must reject
   * a null result — never fall back to trusting the payload.
   */
  verifyWebhook(rawBody: string, headers: Headers): NormalizedPaymentEvent | null;

  /** Used by reconciliation to catch webhooks that never arrived. */
  fetchOrderStatus(orderId: string): Promise<NormalizedOrderStatus>;

  refund(input: {
    orderId: string;
    providerPaymentId: string;
    amountPaise: number;
    refundId: string;
  }): Promise<NormalizedRefund>;
}
