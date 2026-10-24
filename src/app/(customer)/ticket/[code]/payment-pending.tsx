"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { fetchJson } from "@/lib/fetch-json";

/**
 * Shown while we wait for the payment webhook.
 *
 * This screen deliberately claims nothing about the payment: it refreshes the
 * small status endpoint until our own database says the booking has changed.
 * Reconciliation catches the case where the webhook never arrives at all, so
 * this can wait patiently rather than guessing.
 */
export function PaymentPending({ bookingCode }: { bookingCode: string }) {
  const router = useRouter();
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const lifetime = new AbortController();
    const startedAt = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let running = false;
    let finished = false;
    let delay = 5_000;
    let nextAllowedAt = 0;

    async function poll() {
      if (running || finished || lifetime.signal.aborted || document.hidden || !navigator.onLine) return;
      if (Date.now() < nextAllowedAt) {
        timer = setTimeout(poll, nextAllowedAt - Date.now());
        return;
      }
      running = true;
      setSeconds(Math.floor((Date.now() - startedAt) / 1000));
      try {
        const { response, body } = await fetchJson<{ status: string }>(
          `/api/ticket/${encodeURIComponent(bookingCode)}/status`,
          { cache: "no-store", signal: lifetime.signal },
        );
        if (response.ok && body.status !== "PENDING") {
          finished = true;
          router.refresh();
        } else if (response.status === 429) {
          const retry = Number(response.headers.get("retry-after"));
          nextAllowedAt = Date.now() + (Number.isFinite(retry) && retry > 0 ? retry * 1000 : 60_000);
        } else if (response.status === 404) {
          finished = true;
          router.refresh();
        }
      } catch {
        // A brief outage must not imply that payment failed; try again later.
      } finally {
        running = false;
        if (!finished && !lifetime.signal.aborted && !document.hidden && navigator.onLine) {
          timer = setTimeout(poll, Math.max(delay, nextAllowedAt - Date.now()));
          delay = Math.min(delay * 2, 30_000);
        }
      }
    }
    const resume = () => {
      clearTimeout(timer);
      if (!document.hidden && navigator.onLine) void poll();
    };
    timer = setTimeout(poll, delay);
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("online", resume);
    window.addEventListener("offline", resume);
    return () => {
      lifetime.abort();
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("online", resume);
      window.removeEventListener("offline", resume);
    };
  }, [router, bookingCode]);

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
