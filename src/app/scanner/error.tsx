"use client";

import { useEffect } from "react";

/**
 * Last line of defence at the gate. If anything in the scanner tree throws, the
 * default is a blank screen and a staff member who assumes the whole system is
 * down. This keeps a readable, thumb-sized way back — and because the boarding
 * queue lives in IndexedDB, neither recovery path loses a scan that has already
 * been recorded.
 */
export default function ScannerError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[scanner] crashed", error);
  }, [error]);

  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center gap-5 bg-neutral-950 p-6 text-center text-white">
      <p className="text-5xl" aria-hidden>
        ⚠️
      </p>
      <div>
        <p className="text-xl font-bold">The scanner stopped</p>
        <p className="mt-2 max-w-sm text-neutral-300">
          Nothing already scanned has been lost. Restart it, and check tickets at the counter if it
          keeps happening.
        </p>
      </div>
      <button
        type="button"
        onClick={reset}
        className="rounded-2xl bg-white px-8 py-5 text-lg font-bold text-neutral-900"
      >
        Restart scanner
      </button>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="rounded-2xl border border-white/40 px-8 py-4 text-base"
      >
        Reload the page
      </button>
    </div>
  );
}
