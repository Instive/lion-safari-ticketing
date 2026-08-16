"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { formatPaise } from "@/lib/money";
import { createCashSaleAction, type CashSaleState } from "./actions";

type Props = {
  perVisitorPaise: number;
  maxVisitors: number;
  /**
   * Minted on the server when this screen was rendered. A double-tapped
   * "Cash received" sends the same key twice and yields one booking; starting
   * a new sale renders a new screen and therefore a new key.
   */
  idempotencyKey: string;
};

function ConfirmButton({ total }: { total: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-xl bg-ok px-4 py-5 text-lg font-bold text-white transition-colors hover:brightness-95 disabled:opacity-60"
    >
      {pending ? "Creating ticket…" : `Cash received — ${total}`}
    </button>
  );
}

export function CounterForm({ perVisitorPaise, maxVisitors, idempotencyKey }: Props) {
  const [state, formAction] = useActionState<CashSaleState, FormData>(createCashSaleAction, {});
  const [visitors, setVisitors] = useState(1);

  const total = formatPaise(visitors * perVisitorPaise);

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="visitorCount" value={visitors} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />

      <section>
        <h2 className="mb-3 text-sm font-medium text-muted">How many visitors?</h2>

        <div className="grid grid-cols-5 gap-2">
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setVisitors(n)}
              aria-pressed={visitors === n}
              className={`rounded-xl border py-5 text-xl font-bold transition-colors ${
                visitors === n
                  ? "border-brand bg-brand text-white"
                  : "border-line bg-surface hover:border-brand"
              }`}
            >
              {n}
            </button>
          ))}
        </div>

        <div className="mt-3 flex items-center justify-center gap-4">
          <button
            type="button"
            onClick={() => setVisitors((v) => Math.max(1, v - 1))}
            className="touch-target w-16 rounded-xl border border-line bg-surface text-2xl font-bold"
            aria-label="One fewer visitor"
          >
            −
          </button>
          <output className="min-w-24 text-center text-3xl font-bold tabular-nums">
            {visitors}
          </output>
          <button
            type="button"
            onClick={() => setVisitors((v) => Math.min(maxVisitors, v + 1))}
            className="touch-target w-16 rounded-xl border border-line bg-surface text-2xl font-bold"
            aria-label="One more visitor"
          >
            +
          </button>
        </div>
      </section>

      <details className="rounded-xl border border-line bg-surface p-4">
        <summary className="cursor-pointer text-sm font-medium">
          Add guest name or phone (optional)
        </summary>
        <div className="mt-3 space-y-3">
          <input
            name="customerName"
            placeholder="Guest name"
            maxLength={120}
            className="touch-target w-full rounded-lg border border-line px-3 text-base outline-none focus:border-brand"
          />
          <input
            name="customerPhone"
            placeholder="Phone number"
            inputMode="tel"
            maxLength={20}
            className="touch-target w-full rounded-lg border border-line px-3 text-base outline-none focus:border-brand"
          />
          <p className="text-muted text-xs">
            Recording a phone number lets the counter find this ticket again if the guest loses it.
          </p>
        </div>
      </details>

      <div className="rounded-xl border border-line bg-surface p-4">
        <div className="flex items-baseline justify-between">
          <span className="text-muted text-sm">
            {visitors} × {formatPaise(perVisitorPaise)}
          </span>
          <span className="text-2xl font-bold">{total}</span>
        </div>
      </div>

      {state.error ? (
        <p role="alert" className="rounded-lg bg-danger/5 px-3 py-2 text-sm text-danger">
          {state.error}
        </p>
      ) : null}

      <ConfirmButton total={total} />
      <p className="text-muted text-center text-xs">
        Collect the cash before confirming. The ticket prints on the next screen.
      </p>
    </form>
  );
}
