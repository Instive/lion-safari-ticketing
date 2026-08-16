"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { recoverTicketAction, type RecoverState } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="touch-target w-full rounded-xl bg-brand px-4 font-semibold text-white hover:bg-brand-strong disabled:opacity-60"
    >
      {pending ? "Looking…" : "Find my ticket"}
    </button>
  );
}

export function RecoverForm() {
  const [state, formAction] = useActionState<RecoverState, FormData>(recoverTicketAction, {});

  return (
    <form action={formAction} className="space-y-4 rounded-xl border border-line bg-surface p-5">
      <div>
        <label htmlFor="bookingCode" className="mb-1 block text-sm font-medium">
          Booking code
        </label>
        <input
          id="bookingCode"
          name="bookingCode"
          placeholder="LS7K2M9Q"
          autoCapitalize="characters"
          required
          maxLength={20}
          className="touch-target w-full rounded-lg border border-line px-3 font-mono text-base uppercase tracking-wider outline-none focus:border-brand"
        />
      </div>

      <div>
        <label htmlFor="phone" className="mb-1 block text-sm font-medium">
          Mobile number
        </label>
        <input
          id="phone"
          name="phone"
          inputMode="numeric"
          autoComplete="tel"
          placeholder="10-digit number"
          required
          maxLength={10}
          className="touch-target w-full rounded-lg border border-line px-3 text-base outline-none focus:border-brand"
        />
      </div>

      {state.error ? (
        <p role="alert" className="rounded-lg bg-danger/5 px-3 py-2 text-sm text-danger">
          {state.error}
        </p>
      ) : null}

      <SubmitButton />
    </form>
  );
}
