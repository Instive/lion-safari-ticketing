"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { voidOwnSaleAction, type VoidSaleState } from "../../actions";

function VoidSubmit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="touch-target rounded-lg bg-danger px-4 text-sm font-semibold text-white disabled:opacity-60"
    >
      {pending ? "Voiding…" : "Void this sale"}
    </button>
  );
}

/**
 * Deliberately tucked away below the main actions and closed by default —
 * this is a correction path for a just-made mistake, not something that
 * should compete visually with Print / Next sale. Only rendered by the page
 * when the sale is actually eligible (own, today, not yet used at the gate),
 * so staff never sees a button here that's just going to be refused.
 */
export function VoidSaleForm({ bookingCode }: { bookingCode: string }) {
  const [state, formAction] = useActionState<VoidSaleState, FormData>(voidOwnSaleAction, {});
  const [open, setOpen] = useState(false);

  if (state.voided) {
    return (
      <p className="no-print mt-4 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-muted">
        Sale voided. The QR above is no longer valid — start a new sale for the correct count.
      </p>
    );
  }

  return (
    <div className="no-print mt-4 border-t border-line pt-4">
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-muted text-xs underline underline-offset-4 hover:text-danger"
        >
          Mis-keyed the count? Void this sale
        </button>
      ) : (
        <form action={formAction} className="space-y-2">
          <input type="hidden" name="bookingCode" value={bookingCode} />
          <label htmlFor="void-reason" className="text-muted block text-xs">
            Reason (kept in the audit log)
          </label>
          <div className="flex gap-2">
            <input
              id="void-reason"
              name="reason"
              placeholder="e.g. entered 5 instead of 3"
              required
              minLength={3}
              className="touch-target flex-1 rounded-lg border border-line px-3 text-sm outline-none focus:border-danger"
            />
            <VoidSubmit />
          </div>
          {state.error ? (
            <p role="alert" className="text-xs text-danger">
              {state.error}
            </p>
          ) : null}
        </form>
      )}
    </div>
  );
}
