"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import type { BookingStatus } from "@/db/schema";
import {
  cancelBookingAction,
  refundBookingAction,
  resendTicketAction,
  type AdminActionState,
} from "../actions";

function Submit({ label, tone }: { label: string; tone: "danger" | "neutral" }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={`touch-target rounded-lg px-4 font-semibold disabled:opacity-60 ${
        tone === "danger"
          ? "bg-danger text-white hover:brightness-95"
          : "border border-line bg-surface hover:bg-background"
      }`}
    >
      {pending ? "Working…" : label}
    </button>
  );
}

function Message({ state }: { state: AdminActionState }) {
  if (state.error) {
    return (
      <p role="alert" className="mt-2 rounded-lg bg-danger/5 px-3 py-2 text-sm text-danger">
        {state.error}
      </p>
    );
  }
  if (state.success) {
    return <p className="mt-2 rounded-lg bg-ok/5 px-3 py-2 text-sm text-ok">{state.success}</p>;
  }
  return null;
}

export function BookingActions({
  bookingCode,
  status,
  channel,
  hasEmail,
}: {
  bookingCode: string;
  status: BookingStatus;
  channel: "ONLINE" | "COUNTER";
  hasEmail: boolean;
}) {
  const [cancelState, cancel] = useActionState<AdminActionState, FormData>(cancelBookingAction, {});
  const [refundState, refund] = useActionState<AdminActionState, FormData>(refundBookingAction, {});
  const [resendState, resend] = useActionState<AdminActionState, FormData>(resendTicketAction, {});

  const canCancel = status === "PAID" || status === "CASH_CONFIRMED" || status === "PENDING";
  const canRefund = status === "PAID" && channel === "ONLINE";
  const canResend =
    hasEmail && (status === "PAID" || status === "CASH_CONFIRMED");

  if (!canCancel && !canRefund && !canResend) return null;

  return (
    <section className="mt-6 rounded-xl border border-line bg-surface p-5">
      <h2 className="font-semibold">Actions</h2>
      <p className="text-muted mt-1 text-sm">
        Every action here is recorded in the audit trail with your name.
      </p>

      {canResend ? (
        <form action={resend} className="mt-4">
          <input type="hidden" name="bookingCode" value={bookingCode} />
          <Submit label="Re-send ticket email" tone="neutral" />
          <p className="text-muted mt-1 text-xs">
            Sends the same ticket again — it never creates a second one.
          </p>
          <Message state={resendState} />
        </form>
      ) : null}

      {canRefund ? (
        <form action={refund} className="mt-5 border-t border-line pt-4">
          <input type="hidden" name="bookingCode" value={bookingCode} />
          <label className="mb-1 block text-sm font-medium" htmlFor="refund-reason">
            Refund this booking
          </label>
          <div className="flex flex-wrap gap-2">
            <input
              id="refund-reason"
              name="reason"
              placeholder="Reason for the refund"
              required
              minLength={3}
              className="touch-target min-w-48 flex-1 rounded-lg border border-line px-3 text-base outline-none focus:border-brand"
            />
            <Submit label="Refund" tone="danger" />
          </div>
          <p className="text-muted mt-1 text-xs">
            Voids the ticket immediately and asks the provider to return the money.
          </p>
          <Message state={refundState} />
        </form>
      ) : null}

      {canCancel ? (
        <form action={cancel} className="mt-5 border-t border-line pt-4">
          <input type="hidden" name="bookingCode" value={bookingCode} />
          <label className="mb-1 block text-sm font-medium" htmlFor="cancel-reason">
            Cancel this booking
          </label>
          <div className="flex flex-wrap gap-2">
            <input
              id="cancel-reason"
              name="reason"
              placeholder="Reason for the cancellation"
              required
              minLength={3}
              className="touch-target min-w-48 flex-1 rounded-lg border border-line px-3 text-base outline-none focus:border-brand"
            />
            <Submit label="Cancel booking" tone="danger" />
          </div>
          <p className="text-muted mt-1 text-xs">
            {channel === "COUNTER"
              ? "Voids the ticket. Return the cash at the counter."
              : "Voids the ticket without sending a gateway refund."}
          </p>
          <Message state={cancelState} />
        </form>
      ) : null}
    </section>
  );
}
