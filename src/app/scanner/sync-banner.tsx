"use client";

import { useEffect, useState } from "react";

/**
 * Always-visible sync status.
 *
 * The rule this enforces (spec §7.1): never silently present stale data as
 * real-time. When the last successful sync is older than the configured
 * threshold, the banner turns into an unmissable warning so staff know the
 * device may not have today's newest bookings.
 */
export function SyncBanner({
  lastSyncAt,
  staleThresholdSeconds,
  queueDepth,
  online,
}: {
  lastSyncAt: string | null;
  staleThresholdSeconds: number;
  queueDepth: number;
  online: boolean;
}) {
  // Ticks every second so "synced Xs ago" keeps counting up even when no sync
  // succeeds — the number climbing is the signal that something is wrong.
  const [nowMs, setNowMs] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!lastSyncAt) {
    return (
      <div className="bg-amber-500 px-4 py-3 text-center font-semibold text-black">
        Not synced yet — waiting for first connection
      </div>
    );
  }

  // Before the first tick, report zero rather than guessing with an impure read.
  const ageSeconds =
    nowMs === 0 ? 0 : Math.max(0, Math.floor((nowMs - new Date(lastSyncAt).getTime()) / 1000));
  const stale = ageSeconds > staleThresholdSeconds;

  if (stale) {
    return (
      <div className="bg-amber-500 px-4 py-3 text-center text-black">
        <p className="text-lg font-bold">⚠ NOT SYNCED FOR {formatAge(ageSeconds)}</p>
        <p className="text-sm">
          Recent bookings may be missing. Check tickets at the counter if unsure.
          {queueDepth > 0 ? ` ${queueDepth} boarding(s) waiting to upload.` : ""}
        </p>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-3 bg-neutral-900 px-4 py-2 text-sm text-neutral-300">
      <span className="flex items-center gap-2">
        <span
          className={`inline-block h-2 w-2 rounded-full ${online ? "bg-emerald-400" : "bg-amber-400"}`}
          aria-hidden
        />
        {online ? "Online" : "Offline"} · synced {formatAge(ageSeconds)} ago
      </span>
      {queueDepth > 0 ? <span>{queueDepth} to upload</span> : null}
    </div>
  );
}

function formatAge(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
