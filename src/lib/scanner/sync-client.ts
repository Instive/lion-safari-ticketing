"use client";

import {
  applyTickets,
  getMeta,
  scannerDb,
  setMeta,
  type CachedTicket,
  type QueuedEvent,
} from "./db";

const DEVICE_KEY_STORAGE = "ls_scanner_device_key";

/**
 * The device key lives in localStorage and is exposed as a subscribable store,
 * so React reads it through `useSyncExternalStore` rather than copying it into
 * state during an effect.
 */
const keyListeners = new Set<() => void>();

export function getDeviceKey(): string | null {
  if (typeof localStorage === "undefined") return null;
  return localStorage.getItem(DEVICE_KEY_STORAGE);
}

export function subscribeDeviceKey(onChange: () => void): () => void {
  keyListeners.add(onChange);
  return () => keyListeners.delete(onChange);
}

/** Server render has no device key. */
export function getDeviceKeyServerSnapshot(): string | null {
  return null;
}

export function setDeviceKey(key: string): void {
  localStorage.setItem(DEVICE_KEY_STORAGE, key.trim());
  keyListeners.forEach((l) => l());
}

export function clearDeviceKey(): void {
  localStorage.removeItem(DEVICE_KEY_STORAGE);
  keyListeners.forEach((l) => l());
}

/** Connectivity, also as a store so render stays pure. */
export function subscribeOnline(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

export function getOnlineSnapshot(): boolean {
  return navigator.onLine;
}

export function getOnlineServerSnapshot(): boolean {
  return true;
}

export type SyncState = {
  lastSyncAt: string | null;
  version: number;
  visitDate: string | null;
  queueDepth: number;
  /** Server time observed at the last successful sync, for staleness display. */
  staleThresholdSeconds: number;
};

type SyncResponse = {
  serverTime: string;
  version: number;
  fullSync: boolean;
  visitDate: string;
  tickets: CachedTicket[];
  staleThresholdSeconds: number;
};

function headers(): HeadersInit {
  const key = getDeviceKey();
  return {
    "content-type": "application/json",
    ...(key ? { "x-device-key": key } : {}),
  };
}

export class DeviceUnauthorizedError extends Error {
  constructor() {
    super("device not authorized");
  }
}

/**
 * Pulls incremental changes and pushes any queued boardings.
 *
 * Push happens BEFORE pull so a boarding recorded offline is reflected in the
 * manifest we then receive, rather than being overwritten by a stale ACTIVE
 * status from the server.
 */
export async function runSync(): Promise<SyncState> {
  await pushQueue();

  const meta = await getMeta();
  const res = await fetch(`/api/scanner/sync?since=${meta.version}`, {
    headers: headers(),
    cache: "no-store",
  });

  if (res.status === 401) throw new DeviceUnauthorizedError();
  if (!res.ok) throw new Error(`sync failed: ${res.status}`);

  const payload = (await res.json()) as SyncResponse;

  // The park day rolled over (or this is a new device): start the manifest clean.
  const dayChanged = meta.visitDate !== null && meta.visitDate !== payload.visitDate;
  await applyTickets(payload.tickets, payload.fullSync || dayChanged);

  await setMeta({
    version: payload.version,
    // Server time, not the device clock — the device's clock is never trusted.
    lastSyncAt: payload.serverTime,
    visitDate: payload.visitDate,
  });

  return {
    lastSyncAt: payload.serverTime,
    version: payload.version,
    visitDate: payload.visitDate,
    queueDepth: await scannerDb.queue.count(),
    staleThresholdSeconds: payload.staleThresholdSeconds,
  };
}

/**
 * Sends queued boardings. Every event carries the `clientEventId` minted when it
 * was recorded, so re-sending after a failed attempt can never double-board.
 */
export async function pushQueue(): Promise<void> {
  const queued = await scannerDb.queue.orderBy("clientEventId").limit(50).toArray();
  if (queued.length === 0) return;

  const res = await fetch("/api/scanner/events", {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      events: queued.map((q) => ({
        clientEventId: q.clientEventId,
        ticketId: q.ticketId,
        boardedCount: q.boardedCount,
        createdOffline: q.createdOffline,
        deviceReportedAt: q.deviceReportedAt,
      })),
    }),
  });

  if (res.status === 401) throw new DeviceUnauthorizedError();
  if (!res.ok) throw new Error(`event push failed: ${res.status}`);

  const body = (await res.json()) as {
    results: { clientEventId: string; accepted: boolean; duplicate: boolean; reason?: string }[];
  };

  for (const result of body.results) {
    if (result.accepted) {
      // Confirmed by the server (or already known to it) — safe to forget.
      await scannerDb.queue.delete(result.clientEventId);
    } else if (result.reason) {
      // The server made a definitive judgement (already used, cancelled, …).
      // Retrying will not change it, so stop holding the event.
      await scannerDb.queue.delete(result.clientEventId);
      console.warn(`[scanner] server rejected boarding: ${result.reason}`);
    } else {
      // Transient failure: keep it queued and try again next cycle.
      const existing = await scannerDb.queue.get(result.clientEventId);
      if (existing) {
        await scannerDb.queue.put({ ...existing, attempts: existing.attempts + 1 });
      }
    }
  }
}

/** Records a boarding locally and queues it for the server. */
export async function recordBoardingLocally(input: {
  ticketId: string;
  boardedCount: number;
  online: boolean;
}): Promise<QueuedEvent> {
  const event: QueuedEvent = {
    clientEventId: crypto.randomUUID(),
    ticketId: input.ticketId,
    boardedCount: input.boardedCount,
    createdOffline: !input.online,
    deviceReportedAt: new Date().toISOString(),
    attempts: 0,
  };

  await scannerDb.transaction("rw", scannerDb.queue, scannerDb.tickets, async () => {
    await scannerDb.queue.put(event);
    // Reflect the consumption immediately so a second scan of the same QR is
    // refused even while the device is offline.
    await scannerDb.tickets.update(input.ticketId, {
      status: "USED",
      usedAt: new Date().toISOString(),
    });
  });

  return event;
}
