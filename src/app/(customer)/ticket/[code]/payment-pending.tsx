"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Shown while we wait for the payment webhook.
 *
 * This screen deliberately claims nothing about the payment: it refreshes the
 * server-rendered page until our own database says the booking is confirmed.
 * Reconciliation catches the case where the webhook never arrives at all, so
 * this can wait patiently rather than guessing.
 */
export function PaymentPending({ bookingCode }: { bookingCode: string }) {
  const router = useRouter();
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const tick = setInterval(() => setSeconds((s) => s + 3), 3000);
    const poll = setInterval(() => router.refresh(), 3000);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
    };
  }, [router]);

  const slow = seconds >= 30;

  return (
    <div className="rounded-xl border border-line bg-surface p-6 text-center">
      <div
        className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-line border-t-brand"
        role="status"
        aria-label="Confirming payment"
      />
      <h1 className="text-lg font-semibold">Confirming your payment</h1>
      <p className="text-muted mt-2 text-sm">
        This usually takes a few seconds. Please keep this page open — your ticket appears here
        automatically.
      </p>

      <p className="text-muted mt-4 font-mono text-sm">
        Booking <span className="font-bold tracking-wider">{bookingCode}</span>
      </p>

      {slow ? (
        <p className="mt-4 rounded-lg bg-background px-3 py-2 text-xs text-muted">
          Still confirming. If your money was deducted, your ticket will be issued and emailed
          automatically — you do not need to pay again.
        </p>
      ) : null}
    </div>
  );
}
