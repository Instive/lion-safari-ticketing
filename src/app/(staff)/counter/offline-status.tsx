"use client";

import { useState, useTransition } from "react";

import { setCounterDeviceKey } from "@/lib/counter/sync-client";
import { enrolThisTillAction } from "./actions";
import type { OfflineCounter } from "./use-offline-counter";

/**
 * Tells staff, at a glance, whether this till can keep selling if the link
 * drops.
 *
 * What it deliberately does NOT tell them is how many pre-issued tickets are
 * left. That number is stock control, not counter work: it is the office's to
 * watch (Admin → Ticket books), and on the sale screen it only invites staff to
 * ration tickets or to treat a healthy book as a target. Staff need to know
 * whether they can sell, and to hear about it early if they are running out —
 * both of which are states, not numbers.
 *
 * Deliberately quiet while everything is fine: a green "all good" badge on a
 * counter screen is noise that gets ignored, and then so is the red one.
 */
export function OfflineStatus({ counter }: { counter: OfflineCounter }) {
  const totalStock = [...counter.state.stock.values()].reduce((sum, n) => sum + n, 0);

  if (!counter.enrolled) return <EnrolmentPrompt counter={counter} />;

  const outOfStock = counter.ready && totalStock === 0;

  if (!counter.online) {
    return (
      <section
        role="status"
        className={`no-print rounded-xl border p-3 text-sm ${
          outOfStock ? "border-danger/40 bg-danger/5" : "border-accent/40 bg-accent/5"
        }`}
      >
        <p className={`font-semibold ${outOfStock ? "text-danger" : "text-accent"}`}>
          {outOfStock ? "Offline — no tickets left" : "Offline — selling from the ticket book"}
        </p>
        <p className="text-muted mt-0.5">
          {outOfStock
            ? "This till has used every pre-issued ticket. Wait for the connection to return before selling more."
            : "Sales reach the office automatically when the connection returns."}
        </p>
        {/* Their own sales still waiting to reach the office — this is the one
            number that is theirs to act on, and it is not stock. */}
        {counter.state.queueDepth > 0 ? (
          <p className="text-muted mt-2 text-xs">
            {counter.state.queueDepth} sale{counter.state.queueDepth === 1 ? "" : "s"} waiting to
            sync.
          </p>
        ) : null}
      </section>
    );
  }

  // Online: only worth a line if something needs attention.
  if (counter.state.queueDepth > 0) {
    return (
      <section role="status" className="no-print rounded-xl border border-line bg-surface p-3 text-sm">
        <p className="text-muted">
          Syncing {counter.state.queueDepth} offline sale
          {counter.state.queueDepth === 1 ? "" : "s"}…
        </p>
      </section>
    );
  }

  if (counter.ready && totalStock < LOW_STOCK) {
    return (
      <section role="status" className="no-print rounded-xl border border-accent/40 bg-accent/5 p-3 text-sm">
        <p className="font-semibold text-accent">Ticket book running low</p>
        <p className="text-muted mt-0.5">
          It refills by itself while the connection is up — if this message stays, tell the office.
        </p>
      </section>
    );
  }

  return null;
}

/**
 * How few blanks left before staff are warned.
 *
 * Kept here rather than shown: the warning has to fire early enough that the
 * office can act before a till is actually stuck, which means the threshold is
 * an operational decision, not something to reason about at the counter.
 */
const LOW_STOCK = 10;

/**
 * Turning this till into an enrolled counter device.
 *
 * One tap. The till does need a device identity — books of blanks are bound to
 * it, which is what lets an admin void everything unsold on a lost tablet, and
 * what keeps a queued sale authenticatable after the shift that made it has
 * ended. What it does not need is for staff to go to the admin portal, register
 * a device and carry a key back by hand.
 *
 * The paste route is kept, folded away, for the till an admin has already
 * registered centrally.
 */
function EnrolmentPrompt({ counter }: { counter: OfflineCounter }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showPaste, setShowPaste] = useState(false);
  const [key, setKey] = useState("");

  function enrol() {
    setError(null);
    startTransition(async () => {
      const result = await enrolThisTillAction();
      if (result.deviceKey) {
        setCounterDeviceKey(result.deviceKey);
        counter.refresh();
      } else {
        setError(result.error ?? "Could not set this till up.");
      }
    });
  }

  return (
    <section className="no-print rounded-xl border border-line bg-surface p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted">
          <span className="font-semibold text-foreground">Offline selling is off.</span> If the
          internet drops, this till cannot issue tickets.
        </p>
        <button
          type="button"
          onClick={enrol}
          disabled={pending}
          className="rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-strong disabled:opacity-60"
        >
          {pending ? "Setting up…" : "Set up this till"}
        </button>
      </div>

      {error ? (
        <p role="alert" className="mt-2 text-xs text-danger">
          {error}
        </p>
      ) : null}

      {!showPaste ? (
        <button
          type="button"
          onClick={() => setShowPaste(true)}
          className="text-muted mt-2 text-xs underline underline-offset-4 hover:text-brand"
        >
          This till was registered by the office
        </button>
      ) : (
        <div className="mt-3 space-y-2 border-t border-line pt-3">
          <label htmlFor="counter-device-key" className="text-muted block text-xs">
            Paste the device key from Admin → Devices.
          </label>
          <div className="flex gap-2">
            <input
              id="counter-device-key"
              value={key}
              onChange={(event) => setKey(event.target.value)}
              placeholder="Paste device key"
              autoComplete="off"
              spellCheck={false}
              className="flex-1 rounded-lg border border-line px-3 py-2 font-mono text-sm outline-none focus:border-brand"
            />
            <button
              type="button"
              disabled={key.trim().length < 20}
              onClick={() => {
                setCounterDeviceKey(key);
                setKey("");
                setShowPaste(false);
                counter.refresh();
              }}
              className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              Save
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
