"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import {
  getOnlineServerSnapshot,
  getOnlineSnapshot,
  subscribeOnline,
} from "@/lib/online-store";
import { claimBlank, type Blank } from "@/lib/counter/db";
import { blockMessage, type SellBlockReason } from "@/lib/counter/park-day";
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

/**
 * Why a sale could not be made from the book.
 *
 * `OUT_OF_STOCK` is about this group size; every other reason means the till
 * must not print a dated ticket at all right now (see `lib/counter/park-day`).
 */
export type SellOutcome =
  | { ok: true; blank: Blank; issuedAt: Date }
  | { ok: false; reason: "OUT_OF_STOCK" | SellBlockReason; message: string };

export type OfflineCounter = {
  online: boolean;
  enrolled: boolean;
  state: CounterSyncState;
  /** True once the first book has been pulled — until then, selling offline is blind. */
  ready: boolean;
  refresh: () => void;
  /** Consumes a blank and queues the sale, or explains why it could not. */
  sell: (input: OfflineSaleInput) => Promise<SellOutcome>;
};

const EMPTY_STATE: CounterSyncState = {
  lastSyncAt: null,
  visitDate: null,
  blocked: null,
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
    async (input: OfflineSaleInput): Promise<SellOutcome> => {
      // Re-read rather than trusting `state`: this decides what DATE gets
      // printed on a ticket, and the render it came from may predate a day
      // rollover that happened while the sale screen sat open.
      const local = await counterState();
      const visitDate = local.visitDate;
      if (!visitDate) {
        const reason = local.blocked ?? "NO_SYNC";
        return { ok: false, reason, message: blockMessage(reason) };
      }

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

      if (!claimed) {
        return {
          ok: false,
          reason: "OUT_OF_STOCK",
          message:
            `No pre-issued ticket left for ${input.visitorCount} visitor` +
            `${input.visitorCount === 1 ? "" : "s"}. ` +
            "Split the group across two tickets, or wait for the connection.",
        };
      }

      setState(await counterState());
      return {
        ok: true,
        blank: claimed.blank,
        issuedAt: new Date(claimed.queued.soldOfflineAt),
      };
    },
    [],
  );

  return { online, enrolled, state, ready, refresh, sell };
}
