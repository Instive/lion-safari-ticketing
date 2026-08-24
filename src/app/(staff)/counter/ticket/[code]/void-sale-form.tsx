"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { voidOwnSaleAction, type VoidSaleState } from "../../actions";

function ConfirmCancel() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="touch-target flex-1 rounded-xl bg-danger px-4 font-semibold text-white transition-colors hover:brightness-95 disabled:opacity-60"
    >
      {pending ? "Cancelling…" : "Yes, cancel"}
    </button>
  );
}

/**
 * Cancels a sale that was just made — a mis-keyed visitor count being the case
 * this exists for.
 *
 * Two taps, and the second one is the confirmation: at a counter with a queue
 * behind it, anything longer gets worked around rather than used. The
 * destructive step is the one wearing the danger colour, and "No" is the wider,
 * calmer target of the two, so a mis-tap lands on the harmless option.
 *
 * Only rendered when the sale is actually eligible (own, today, not yet used at
 * the gate), so staff never meet a button here that is only going to refuse.
 */
export function VoidSaleForm({ bookingCode }: { bookingCode: string }) {
  const [state, formAction] = useActionState<VoidSaleState, FormData>(voidOwnSaleAction, {});
  const [confirming, setConfirming] = useState(false);

  if (state.voided) {
    return (
      <p className="no-print text-muted mt-4 rounded-lg border border-line bg-surface px-3 py-2 text-sm">
        Ticket cancelled. The QR above is no longer valid — start a new sale for the correct
        count.
      </p>
    );
  }

  return (
    <div className="no-print border-t border-line pt-4 lg:border-t-0 lg:pt-0">
      {!confirming ? (
        <>
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="touch-target w-full rounded-xl border-2 border-danger px-4 font-semibold text-danger transition-colors hover:bg-danger hover:text-white"
          >
            Cancel ticket
          </button>
          {state.error ? (
            <p role="alert" className="mt-2 text-xs text-danger">
              {state.error}
            </p>
          ) : null}
        </>
      ) : (
        <form action={formAction}>
          <input type="hidden" name="bookingCode" value={bookingCode} />
          <p className="mb-2 text-center text-sm font-semibold">
            Cancel ticket {bookingCode}?
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="touch-target flex-[1.4] rounded-xl border border-line bg-surface px-4 font-semibold hover:bg-background"
            >
              No, keep it
            </button>
            <ConfirmCancel />
          </div>
        </form>
      )}
    </div>
  );
}
