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

function clamp(count: number, maxVisitors: number): number {
  return Math.min(maxVisitors, Math.max(1, count));
}

/** Quick-pick counts. Anything larger is reached with the +/− stepper. */
const QUICK_COUNTS = Array.from({ length: 10 }, (_, i) => i + 1);

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
function ConfirmButton({
  total,
  visitors,
  ready,
}: {
  total: string;
  visitors: number;
  ready: boolean;
}) {
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
        disabled={pending || !ready}
        className="flex w-full items-center justify-between gap-4 rounded-xl bg-ok px-5 py-5 text-left text-white transition-colors hover:brightness-95 disabled:opacity-60"
      >
        <span className="text-lg font-bold">
          {pending ? "Creating ticket…" : ready ? "Cash received" : "Enter the visitor count"}
        </span>
        {pending || !ready ? (
          <span
            aria-hidden
            className={
              pending
                ? "h-5 w-5 animate-spin rounded-full border-2 border-white/40 border-t-white"
                : "hidden"
            }
          />
        ) : (
          <span className="text-right leading-tight">
            <span className="block text-xl font-bold tabular-nums">{total}</span>
            <span className="block text-xs font-medium text-white/80">
              {visitors} visitor{visitors === 1 ? "" : "s"}
            </span>
          </span>
        )}
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
  /**
   * The count as typed, not as a number: it is the single source of truth for
   * the quick-pick buttons, the stepper and the box staff can type into, and
   * keeping it as text is what lets the box be cleared mid-edit without the
   * form silently falling back to some other count.
   */
  const [countText, setCountText] = useState("1");

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

  const parsed = Number.parseInt(countText, 10);
  const ready = Number.isInteger(parsed) && parsed >= 1 && parsed <= maxVisitors;
  // An unreadable box prices nothing and confirms nothing — the button below
  // stays disabled rather than guessing a count for money that's changing hands.
  const visitors = ready ? parsed : 0;
  const totalPaise = visitors * perVisitorPaise;
  const total = formatPaise(totalPaise);

  function pick(next: number) {
    setCountText(String(clamp(next, maxVisitors)));
  }

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="visitorCount" value={visitors} />
      <input type="hidden" name="idempotencyKey" value={draftKey} />

      <section className="rounded-xl border border-line bg-surface p-4">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">How many visitors?</h2>
          <span className="text-muted text-xs">Tap, step or type</span>
        </div>

        <div className="grid grid-cols-5 gap-2">
          {QUICK_COUNTS.map((n) => {
            const selected = visitors === n;
            return (
              <button
                key={n}
                type="button"
                onClick={() => pick(n)}
                aria-pressed={selected}
                className={`rounded-xl border py-5 text-xl font-bold tabular-nums transition-colors ${
                  selected
                    ? "border-brand bg-brand text-white ring-2 ring-brand/25"
                    : "border-line bg-background hover:border-brand"
                }`}
              >
                {n}
              </button>
            );
          })}
        </div>

        {/* Larger groups are typed straight into the box rather than tapped up
            to one at a time. */}
        <div className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-background px-3 py-2">
          <button
            type="button"
            onClick={() => pick(visitors - 1)}
            disabled={visitors <= 1}
            className="touch-target w-16 shrink-0 rounded-xl border border-line bg-surface text-2xl font-bold disabled:opacity-40"
            aria-label="One fewer visitor"
          >
            −
          </button>
          <span className="text-center leading-tight">
            <input
              id="visitor-count"
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              value={countText}
              onChange={(event) => setCountText(event.target.value)}
              onFocus={(event) => event.target.select()}
              aria-label="Number of visitors"
              // Native spinners would sit right next to the −/+ buttons and do the same job.
              className="w-28 rounded-lg border border-line bg-surface px-2 py-1 text-center text-3xl font-bold tabular-nums outline-none [appearance:textfield] focus:border-brand [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
            <span className="text-muted mt-0.5 block text-xs">
              {ready ? `visitor${visitors === 1 ? "" : "s"}` : "enter a number"}
            </span>
          </span>
          <button
            type="button"
            onClick={() => pick(visitors + 1)}
            disabled={!ready || visitors >= maxVisitors}
            className="touch-target w-16 shrink-0 rounded-xl border border-line bg-surface text-2xl font-bold disabled:opacity-40"
            aria-label="One more visitor"
          >
            +
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-line bg-surface p-4">
        <div className="flex items-baseline justify-between">
          <span className="text-muted text-sm tabular-nums">
            {ready ? `${visitors} × ${formatPaise(perVisitorPaise)}` : `${formatPaise(perVisitorPaise)} per visitor`}
          </span>
          <span className="text-3xl font-bold tabular-nums">{ready ? total : "—"}</span>
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

      {state.error ? (
        <p role="alert" className="rounded-lg bg-danger/5 px-3 py-2 text-sm text-danger">
          {state.error}
        </p>
      ) : null}

      {/* Pinned to the bottom of the screen: the confirm action stays reachable
          however far the page has been scrolled, on a short counter display. */}
      <div className="sticky bottom-0 z-10 -mx-4 border-t border-line bg-background/95 px-4 pb-4 pt-3 backdrop-blur">
        <ConfirmButton total={total} visitors={visitors} ready={ready} />
        <p className="text-muted mt-2 text-center text-xs">
          Collect the cash before confirming. The ticket prints on the next screen.
        </p>
      </div>
    </form>
  );
}
