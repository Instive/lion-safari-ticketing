"use client";

import { singleFlight } from "@/lib/single-flight";
import { fetchJson } from "@/lib/fetch-json";
import {
  beginManifest,
  stageManifestPage,
  completeManifest,
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

/**
 * Connectivity, also as a store so render stays pure. Lives in `@/lib/online-store`
 * because the counter needs exactly the same thing; re-exported here so the
 * scanner's imports read from one place.
 */
export {
  getOnlineServerSnapshot,
  getOnlineSnapshot,
  subscribeOnline,
} from "@/lib/online-store";

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
  nextCursor: string | null;
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
export const runSync = singleFlight(async (): Promise<SyncState> => {
  // Serialize across tabs too: staging and the offline outbox live in IndexedDB.
  if (typeof navigator !== "undefined" && navigator.locks) {
    return navigator.locks.request("lion-safari-scanner-sync", syncManifest);
  }
  return syncManifest();
});

async function syncManifest(): Promise<SyncState> {
  await pushQueue();
  const meta = await getMeta();
  const query = new URLSearchParams({ protocol: "2", since: String(meta.version) });
  if (meta.visitDate) query.set("date", meta.visitDate);
  if (meta.lastSyncAt) query.set("syncedAt", meta.lastSyncAt);
  let payload: SyncResponse;
  let first = true;
  let full = false;
  try {
    do {
      const { response, body } = await fetchJson<SyncResponse>(`/api/scanner/sync?${query}`, {
        headers: headers(), cache: "no-store",
      });
      if (response.status === 401) throw new DeviceUnauthorizedError();
      if (!response.ok) throw new Error(`sync failed: ${response.status}`);
      payload = body;
      if (first) {
        full = payload.fullSync;
        if (meta.visitDate && meta.visitDate !== payload.visitDate) {
          // Yesterday's manifest must not admit guests during a day rollover.
          await setMeta({ visitDate: null, version: 0, lastSyncAt: null });
        }
        if (full) await beginManifest();
        first = false;
      }
      if (full) await stageManifestPage(payload.tickets);
      else await applyTickets(payload.tickets, false);
      if (payload.nextCursor) query.set("cursor", payload.nextCursor);
    } while (payload.nextCursor);

    const update = { version: payload.version, lastSyncAt: payload.serverTime, visitDate: payload.visitDate };
    if (full) await completeManifest(update);
    else await setMeta(update);
    return {
      ...update,
      queueDepth: await scannerDb.queue.count(),
      staleThresholdSeconds: payload.staleThresholdSeconds,
    };
  } catch (err) {
    // Leave the completed watermark untouched: the next attempt safely replays.
    if (full) await beginManifest();
    throw err;
  }
}

/**
 * Sends queued boardings. Every event carries the `clientEventId` minted when it
 * was recorded, so re-sending after a failed attempt can never double-board.
 */
export const pushQueue = singleFlight(async (): Promise<void> => {
  const queued = await scannerDb.queue.orderBy("clientEventId").limit(50).toArray();
  if (queued.length === 0) return;

  const { response: res, body } = await fetchJson<{
    results: { clientEventId: string; accepted: boolean; duplicate: boolean; reason?: string }[];
  }>("/api/scanner/events", {
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
});

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
