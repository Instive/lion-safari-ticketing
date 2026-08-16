"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";

import { formatPaise } from "@/lib/money";
import { startBookingAction, type BookingState } from "./actions";

type Props = {
  perVisitorPaise: number;
  convenienceFeePaise: number;
  maxVisitors: number;
  visitDateLabel: string;
  /**
   * Minted on the server for this render. Re-submitting from the same page —
   * a double tap, or a retry after an abandoned checkout — reuses it and so
   * reuses the same booking rather than creating another.
   */
  idempotencyKey: string;
};

declare global {
  interface Window {
    Cashfree?: (opts: { mode: string }) => {
      checkout: (opts: { paymentSessionId: string; redirectTarget?: string }) => void;
    };
  }
}

/**
 * Cashfree's hosted checkout. Card details are entered on their page, never on
 * ours, so no card data ever reaches this application (spec §4.3).
 */
let sdkPromise: Promise<void> | null = null;

function loadCashfreeSdk(): Promise<void> {
  sdkPromise ??= new Promise<void>((resolve, reject) => {
    const existing = document.getElementById("cashfree-sdk");
    if (existing) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.id = "cashfree-sdk";
    script.src = "https://sdk.cashfree.com/js/v3/cashfree.js";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Cashfree SDK failed to load"));
    document.head.appendChild(script);
  });
  return sdkPromise;
}

function PayButton({ total }: { total: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="touch-target w-full rounded-xl bg-brand px-4 text-base font-semibold text-white transition-colors hover:bg-brand-strong disabled:opacity-60"
    >
      {pending ? "Opening secure checkout…" : `Pay ${total}`}
    </button>
  );
}

export function BookingForm({
  perVisitorPaise,
  convenienceFeePaise,
  maxVisitors,
  visitDateLabel,
  idempotencyKey,
}: Props) {
  const [state, formAction] = useActionState<BookingState, FormData>(startBookingAction, {});
  const [visitors, setVisitors] = useState(2);

  // Warm the SDK up front so tapping Pay opens checkout without a wait.
  useEffect(() => {
    void loadCashfreeSdk().catch(() => {});
  }, []);

  useEffect(() => {
    const checkout = state.checkout;
    if (!checkout) return;

    let cancelled = false;
    void (async () => {
      try {
        await loadCashfreeSdk();
      } catch {
        return;
      }
      if (cancelled || !window.Cashfree) return;
      window.Cashfree({ mode: checkout.mode }).checkout({
        paymentSessionId: checkout.paymentSessionId,
        redirectTarget: "_self",
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [state.checkout]);

  const subtotal = visitors * perVisitorPaise;
  const total = subtotal + convenienceFeePaise;

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="visitorCount" value={visitors} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />

      <section className="rounded-xl border border-line bg-surface p-5">
        <h2 className="mb-1 font-medium">How many visitors?</h2>
        <p className="text-muted mb-4 text-sm">Visiting on {visitDateLabel}</p>

        <div className="flex items-center justify-center gap-5">
          <button
            type="button"
            onClick={() => setVisitors((v) => Math.max(1, v - 1))}
            className="touch-target w-16 rounded-xl border border-line text-2xl font-bold"
            aria-label="One fewer visitor"
          >
            −
          </button>
          <output className="min-w-20 text-center text-4xl font-bold tabular-nums">
            {visitors}
          </output>
          <button
            type="button"
            onClick={() => setVisitors((v) => Math.min(maxVisitors, v + 1))}
            className="touch-target w-16 rounded-xl border border-line text-2xl font-bold"
            aria-label="One more visitor"
          >
            +
          </button>
        </div>
      </section>

      <section className="space-y-3 rounded-xl border border-line bg-surface p-5">
        <h2 className="font-medium">Your details</h2>
        <input
          name="customerName"
          placeholder="Full name"
          autoComplete="name"
          required
          maxLength={120}
          className="touch-target w-full rounded-lg border border-line px-3 text-base outline-none focus:border-brand"
        />
        <input
          name="customerPhone"
          placeholder="10-digit mobile number"
          inputMode="numeric"
          autoComplete="tel"
          required
          maxLength={10}
          className="touch-target w-full rounded-lg border border-line px-3 text-base outline-none focus:border-brand"
        />
        <input
          name="customerEmail"
          type="email"
          placeholder="Email address"
          autoComplete="email"
          required
          maxLength={200}
          className="touch-target w-full rounded-lg border border-line px-3 text-base outline-none focus:border-brand"
        />
        <p className="text-muted text-xs">
          Your ticket is emailed here. No account needed.
        </p>
      </section>

      {/* The full payable amount is shown before payment (spec §17). */}
      <section className="rounded-xl border border-line bg-surface p-5">
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted">
              {visitors} × {formatPaise(perVisitorPaise)}
            </dt>
            <dd>{formatPaise(subtotal)}</dd>
          </div>
          {convenienceFeePaise > 0 ? (
            <div className="flex justify-between">
              <dt className="text-muted">Convenience fee</dt>
              <dd>{formatPaise(convenienceFeePaise)}</dd>
            </div>
          ) : null}
          <div className="flex justify-between border-t border-line pt-2 text-base font-bold">
            <dt>Total payable</dt>
            <dd>{formatPaise(total)}</dd>
          </div>
        </dl>
      </section>

      {state.error ? (
        <p role="alert" className="rounded-lg bg-danger/5 px-3 py-2 text-sm text-danger">
          {state.error}
        </p>
      ) : null}

      <PayButton total={formatPaise(total)} />

      <p className="text-muted text-center text-xs">
        Pay securely by UPI or card. Your ticket is issued once payment is confirmed.
      </p>
    </form>
  );
}
