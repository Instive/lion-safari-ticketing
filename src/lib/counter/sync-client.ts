"use client";

import {
  applyBook,
  counterDb,
  getCounterMeta,
  setCounterMeta,
  type Blank,
} from "./db";

const DEVICE_KEY_STORAGE = "ls_counter_device_key";

/**
 * The counter device key, held in localStorage and exposed as a subscribable
 * store so React reads it through `useSyncExternalStore` rather than copying it
 * into state during an effect — the same pattern the scanner uses.
 *
 * A device key rather than the staff session on purpose: sessions last one
 * shift, and an outage that outlives a shift must not strand a queued sale with
 * no way to authenticate it.
 */
const keyListeners = new Set<() => void>();

export function getCounterDeviceKey(): string | null {
  if (typeof localStorage === "undefined") return null;
  return localStorage.getItem(DEVICE_KEY_STORAGE);
}

export function subscribeCounterDeviceKey(onChange: () => void): () => void {
  keyListeners.add(onChange);
  return () => keyListeners.delete(onChange);
}

/** Server render has no device key. */
export function getCounterDeviceKeyServerSnapshot(): string | null {
  return null;
}

export function setCounterDeviceKey(key: string): void {
  localStorage.setItem(DEVICE_KEY_STORAGE, key.trim());
  keyListeners.forEach((l) => l());
}

export function clearCounterDeviceKey(): void {
  localStorage.removeItem(DEVICE_KEY_STORAGE);
  keyListeners.forEach((l) => l());
}

export class CounterDeviceUnauthorizedError extends Error {
  constructor() {
    super("counter device not authorized");
  }
}

function headers(): HeadersInit {
  const key = getCounterDeviceKey();
  return {
    "content-type": "application/json",
    ...(key ? { "x-device-key": key } : {}),
  };
}

export type CounterSyncState = {
  lastSyncAt: string | null;
  visitDate: string | null;
  /** Blanks left, per group size, for the current park day. */
  stock: Map<number, number>;
  queueDepth: number;
};

type BookResponse = {
  serverTime: string;
  visitDate: string;
  allocated: number;
  blanks: Blank[];
};

type SaleResult = {
  bookingId: string;
  accepted: boolean;
  duplicate: boolean;
  bookingCode?: string;
  reason?: string;
  message?: string;
};

/**
 * Pushes queued sales, then pulls a fresh ticket book.
 *
 * Push before pull, for the same reason the scanner does it: the server's view
 * of what is unsold is only correct once it knows what this device has already
 * sold. Pulling first would hand back blanks that are sitting in the outbox.
 */
export async function runCounterSync(): Promise<CounterSyncState> {
  await pushSales();

  const res = await fetch("/api/counter/book", { headers: headers(), cache: "no-store" });
  if (res.status === 401) throw new CounterDeviceUnauthorizedError();
  if (!res.ok) throw new Error(`book sync failed: ${res.status}`);

  const payload = (await res.json()) as BookResponse;
  await applyBook(payload.blanks);
  await setCounterMeta({ lastSyncAt: payload.serverTime, visitDate: payload.visitDate });

  return counterState(payload.visitDate, payload.serverTime);
}

/** Sends everything in the outbox. Safe to call repeatedly. */
export async function pushSales(): Promise<void> {
  const queued = await counterDb.queue.limit(100).toArray();
  if (queued.length === 0) return;

  const res = await fetch("/api/counter/sales", {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      sales: queued.map((sale) => ({
        bookingId: sale.bookingId,
        staffId: sale.staffId ?? undefined,
        rateCategoryId: sale.rateCategoryId ?? undefined,
        customRatePaise: sale.customRatePaise ?? undefined,
        rateNote: sale.rateNote ?? undefined,
        tender: sale.tender ?? "CASH",
        customerName: sale.customerName ?? undefined,
        customerPhone: sale.customerPhone ?? undefined,
        soldOfflineAt: sale.soldOfflineAt,
      })),
    }),
  });

  if (res.status === 401) throw new CounterDeviceUnauthorizedError();
  if (!res.ok) throw new Error(`sale push failed: ${res.status}`);

  const body = (await res.json()) as { results: SaleResult[] };

  for (const result of body.results) {
    if (result.accepted) {
      // Reconciled, or already known to the server — safe to forget either way.
      await counterDb.queue.delete(result.bookingId);
    } else if (result.reason) {
      // A definitive judgement: the blank was voided, or belongs to another
      // counter. Retrying cannot change it, so stop holding the sale — it is
      // reported to admin as a boarded-without-sale discrepancy instead.
      await counterDb.queue.delete(result.bookingId);
      console.warn(`[counter] server rejected offline sale: ${result.reason}`);
    } else {
      const existing = await counterDb.queue.get(result.bookingId);
      if (existing) {
        await counterDb.queue.put({ ...existing, attempts: existing.attempts + 1 });
      }
    }
  }
}

/** Current local state without touching the network — used offline. */
export async function counterState(
  visitDate?: string | null,
  lastSyncAt?: string | null,
): Promise<CounterSyncState> {
  const meta = await getCounterMeta();
  const day = visitDate ?? meta.visitDate;

  const rows = day
    ? await counterDb.blanks.where("visitDate").equals(day).toArray()
    : await counterDb.blanks.toArray();

  const stock = new Map<number, number>();
  for (const row of rows) {
    stock.set(row.visitorCount, (stock.get(row.visitorCount) ?? 0) + 1);
  }

  return {
    lastSyncAt: lastSyncAt ?? meta.lastSyncAt,
    visitDate: day,
    stock,
    queueDepth: await counterDb.queue.count(),
  };
}
