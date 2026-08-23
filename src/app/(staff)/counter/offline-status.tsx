"use client";

import { useState } from "react";

import { setCounterDeviceKey } from "@/lib/counter/sync-client";
import type { OfflineCounter } from "./use-offline-counter";

/**
 * Tells staff, at a glance, whether this till can keep selling if the link
 * drops — and how many tickets it has left to do it with.
 *
 * Deliberately quiet while everything is fine: a green "all good" badge on a
 * counter screen is noise that gets ignored, and then so is the red one.
 */
export function OfflineStatus({ counter }: { counter: OfflineCounter }) {
  const [showEnrol, setShowEnrol] = useState(false);
  const [key, setKey] = useState("");

  const totalStock = [...counter.state.stock.values()].reduce((sum, n) => sum + n, 0);

  if (!counter.enrolled) {
    return (
      <section className="no-print rounded-xl border border-line bg-surface p-3 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-muted">
            <span className="font-semibold text-foreground">Offline selling is off.</span> If the
            internet drops, this till cannot issue tickets.
          </p>
          <button
            type="button"
            onClick={() => setShowEnrol((v) => !v)}
            className="rounded-lg border border-line px-3 py-1.5 text-sm font-semibold hover:border-brand"
          >
            Set up
          </button>
        </div>

        {showEnrol ? (
          <div className="mt-3 space-y-2 border-t border-line pt-3">
            <label htmlFor="counter-device-key" className="text-muted block text-xs">
              Counter device key — register this till under Admin → Devices, then paste the key
              it shows once.
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
                  setShowEnrol(false);
                  counter.refresh();
                }}
                className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                Save
              </button>
            </div>
          </div>
        ) : null}
      </section>
    );
  }

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
            : `${totalStock} pre-issued ticket${totalStock === 1 ? "" : "s"} left. Sales reach the office automatically when the connection returns.`}
        </p>
        <StockBar stock={counter.state.stock} />
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

  if (counter.ready && totalStock < 10) {
    return (
      <section role="status" className="no-print rounded-xl border border-accent/40 bg-accent/5 p-3 text-sm">
        <p className="font-semibold text-accent">Ticket book running low</p>
        <p className="text-muted mt-0.5">
          {totalStock} pre-issued ticket{totalStock === 1 ? "" : "s"} left. It refills by itself —
          if this stays low, tell the office.
        </p>
      </section>
    );
  }

  return null;
}

/** Blanks remaining by group size, so staff can see what they can actually sell. */
function StockBar({ stock }: { stock: Map<number, number> }) {
  const sizes = [...stock.entries()].sort((a, b) => a[0] - b[0]);
  if (sizes.length === 0) return null;

  return (
    <ul className="mt-2 flex flex-wrap gap-1.5">
      {sizes.map(([size, count]) => (
        <li
          key={size}
          className={`rounded-lg border px-2 py-1 text-xs tabular-nums ${
            count === 0 ? "border-line text-muted opacity-50" : "border-line bg-surface"
          }`}
        >
          <span className="font-semibold">{size}</span>
          <span className="text-muted"> visitor{size === 1 ? "" : "s"} · </span>
          <span className="font-semibold">{count}</span>
        </li>
      ))}
    </ul>
  );
}
