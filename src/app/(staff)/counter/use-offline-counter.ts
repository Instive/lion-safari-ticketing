"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import {
  getOnlineServerSnapshot,
  getOnlineSnapshot,
  subscribeOnline,
} from "@/lib/online-store";
import { claimBlank, type Blank } from "@/lib/counter/db";
import {
  clearCounterDeviceKey,
  counterState,
  CounterDeviceUnauthorizedError,
  getCounterDeviceKey,
  getCounterDeviceKeyServerSnapshot,
  runCounterSync,
  subscribeCounterDeviceKey,
  type CounterSyncState,
} from "@/lib/counter/sync-client";

/** How often to top the book up and drain the outbox while online. */
const SYNC_INTERVAL_MS = 60_000;

export type OfflineSaleInput = {
  visitorCount: number;
  perVisitorPaise: number;
  amountTotal: number;
  rateCategoryId: string | null;
  customRatePaise: number | null;
  rateNote: string | null;
  tender: "CASH" | "UPI";
  customerName: string | null;
  customerPhone: string | null;
  staffId: string | null;
};

export type OfflineCounter = {
  online: boolean;
  enrolled: boolean;
  state: CounterSyncState;
  /** True once the first book has been pulled — until then, selling offline is blind. */
  ready: boolean;
  refresh: () => void;
  /** Consumes a blank and queues the sale. Null when the book has none that size. */
  sell: (input: OfflineSaleInput) => Promise<{ blank: Blank; issuedAt: Date } | null>;
};

const EMPTY_STATE: CounterSyncState = {
  lastSyncAt: null,
  visitDate: null,
  stock: new Map(),
  queueDepth: 0,
};

/**
 * The counter's offline half: the ticket book, the outbox, and the sync loop
 * that keeps both current.
 *
 * Deliberately additive — when the device is online, nothing here is used to
 * make a sale. The ordinary server action still runs, still prices the sale on
 * the server and still returns a ticket page. This exists only for the minutes
 * or hours when that is impossible.
 */
export function useOfflineCounter(): OfflineCounter {
  const online = useSyncExternalStore(subscribeOnline, getOnlineSnapshot, getOnlineServerSnapshot);
  const deviceKey = useSyncExternalStore(
    subscribeCounterDeviceKey,
    getCounterDeviceKey,
    getCounterDeviceKeyServerSnapshot,
  );
  const enrolled = deviceKey !== null;

  const [state, setState] = useState<CounterSyncState>(EMPTY_STATE);
  const [ready, setReady] = useState(false);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((n) => n + 1), []);

  const sync = useCallback(async () => {
    if (!getCounterDeviceKey()) return;
    try {
      const next = navigator.onLine ? await runCounterSync() : await counterState();
      setState(next);
      setReady(true);
    } catch (err) {
      if (err instanceof CounterDeviceUnauthorizedError) {
        // Deactivated in admin: the key is worthless and so is anything left in
        // the book, since the server will refuse to reconcile it.
        clearCounterDeviceKey();
        return;
      }
      // Otherwise fall back to whatever is on the device — being offline is the
      // normal case here, not an error worth showing.
      try {
        setState(await counterState());
        setReady(true);
      } catch {
        /* IndexedDB unavailable (private mode); offline selling is simply off */
      }
    }
  }, []);

  useEffect(() => {
    if (!enrolled) return;
    // Deferred a tick so the effect body itself performs no state update.
    const kickoff = setTimeout(() => void sync(), 0);
    const id = setInterval(() => void sync(), SYNC_INTERVAL_MS);
    return () => {
      clearTimeout(kickoff);
      clearInterval(id);
    };
  }, [enrolled, sync, tick]);

  // The link returning is the moment to drain the outbox — waiting out the
  // interval would leave staff staring at a backlog that has already cleared.
  useEffect(() => {
    if (!enrolled || !online) return;
    const id = setTimeout(() => void sync(), 0);
    return () => clearTimeout(id);
  }, [enrolled, online, sync]);

  const sell = useCallback(
    async (input: OfflineSaleInput) => {
      const local = await counterState();
      const visitDate = local.visitDate;
      if (!visitDate) return null;

      const claimed = await claimBlank(visitDate, input.visitorCount, {
        perVisitorPaise: input.perVisitorPaise,
        amountTotal: input.amountTotal,
        rateCategoryId: input.rateCategoryId,
        customRatePaise: input.customRatePaise,
        rateNote: input.rateNote,
        tender: input.tender,
        customerName: input.customerName,
        customerPhone: input.customerPhone,
        staffId: input.staffId,
        soldOfflineAt: new Date().toISOString(),
        attempts: 0,
      });

      if (!claimed) return null;

      setState(await counterState());
      return { blank: claimed.blank, issuedAt: new Date(claimed.queued.soldOfflineAt) };
    },
    [],
  );

  return { online, enrolled, state, ready, refresh, sell };
}
