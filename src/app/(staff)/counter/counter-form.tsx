"use client";

import { useActionState, useEffect, useState, useSyncExternalStore } from "react";
import { useFormStatus } from "react-dom";

import { formatPaise } from "@/lib/money";
import { createCashSaleAction, type CashSaleState } from "./actions";

const DRAFT_KEY_STORAGE = "ls_counter_draft_key";

// sessionStorage is an external system read through useSyncExternalStore
// rather than copied into state during an effect — the same pattern already
// used for the scanner's device-key store. Nothing outside this component
// writes the key while it's mounted, so a no-op subscribe (never notifies) is
// correct: we only need a synchronous, hydration-safe read, not live updates.
function noopSubscribe(): () => void {
  return () => {};
}

type Props = {
  perVisitorPaise: number;
  maxVisitors: number;
  /**
   * Minted on the server when this screen was rendered. A double-tapped
   * "Cash received" sends the same key twice and yields one booking; starting
   * a new sale renders a new screen and therefore a new key.
   *
   * The narrower gap this doesn't cover on its own: if the network drops
   * between the server committing the sale and the redirect reaching the
   * browser, staff sees an ambiguous failure — and reloading `/counter` to
   * retry re-runs this Server Component, minting a genuinely NEW key, so the
   * retry would create a second booking for the same cash. `sessionStorage`
   * below closes that gap by surviving the reload; the ticket confirmation
   * page clears it once a sale actually succeeds (see clear-draft-sale-key).
   */
  idempotencyKey: string;
};

/** How long a sale is allowed to hang before offering an explicit way out. */
const STUCK_AFTER_MS = 10_000;

/**
 * On a genuinely degraded connection (packets trickling, not a hard
 * disconnect), the request to the server can hang far longer than a normal
 * failure would take to report itself — and while `pending` is true the
 * submit button is disabled by React itself, so staff would otherwise be
 * stuck staring at "Creating ticket…" with no error and no way to retry.
 * This is a real, on-brand risk here, not a hypothetical: the same patchy
 * 4G/Wi-Fi that motivated the scanner's offline design can just as easily
 * sit under the counter terminal.
 *
 * A full reload is the deliberate fix rather than trying to cancel and retry
 * the in-flight request: it's guaranteed to abandon whatever's hanging, and
 * the sessionStorage-persisted idempotency key above makes a reload-and-retry
 * safe rather than risking a duplicate sale.
 */
function ConfirmButton({ total }: { total: string }) {
  const { pending } = useFormStatus();
  // Set only from the timeout callback below (an async, external-event
  // response — the pattern the purity rule itself calls out as correct), and
  // deliberately never reset elsewhere: a successful sale redirects away and
  // unmounts this component, so there's no realistic path where a stale
  // `true` from a finished submission is still visible for a fresh one — the
  // render condition below also checks `pending`, which hides it immediately
  // whenever a request isn't in flight.
  const [stuck, setStuck] = useState(false);

  // Starts the "is this hanging?" timer for THIS pending cycle — syncing
  // with an external timer is exactly what an effect is for; clearing it on
  // a fast/normal completion is the cleanup, not a synchronous setState.
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => setStuck(true), STUCK_AFTER_MS);
    return () => clearTimeout(timer);
  }, [pending]);

  return (
    <>
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-xl bg-ok px-4 py-5 text-lg font-bold text-white transition-colors hover:brightness-95 disabled:opacity-60"
      >
        {pending ? "Creating ticket…" : `Cash received — ${total}`}
      </button>

      {pending && stuck ? (
        <div className="mt-3 rounded-lg border border-accent/30 bg-accent/5 p-3 text-center">
          <p className="text-sm font-medium text-accent">
            This is taking longer than usual — check the connection.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="touch-target mt-2 rounded-lg border border-accent px-4 text-sm font-semibold text-accent"
          >
            Reload and try again
          </button>
          <p className="text-muted mt-1 text-xs">
            Safe to do — this sale won&rsquo;t be duplicated if it already went through.
          </p>
        </div>
      ) : null}
    </>
  );
}

export function CounterForm({ perVisitorPaise, maxVisitors, idempotencyKey }: Props) {
  const [state, formAction] = useActionState<CashSaleState, FormData>(createCashSaleAction, {});
  const [visitors, setVisitors] = useState(1);

  // Server snapshot matches the SSR-rendered hidden input (no hydration
  // mismatch). Client snapshot prefers an unfinished-draft key already in
  // sessionStorage from a previous load of this same tab — see the Props
  // comment above for why — falling back to the fresh server-minted one.
  const draftKey = useSyncExternalStore(
    noopSubscribe,
    () => sessionStorage.getItem(DRAFT_KEY_STORAGE) ?? idempotencyKey,
    () => idempotencyKey,
  );

  // Persists the key so a reload finds it — pure sync-to-external-system,
  // no React state written here.
  useEffect(() => {
    if (!sessionStorage.getItem(DRAFT_KEY_STORAGE)) {
      sessionStorage.setItem(DRAFT_KEY_STORAGE, idempotencyKey);
    }
  }, [idempotencyKey]);

  const total = formatPaise(visitors * perVisitorPaise);

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="visitorCount" value={visitors} />
      <input type="hidden" name="idempotencyKey" value={draftKey} />

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
