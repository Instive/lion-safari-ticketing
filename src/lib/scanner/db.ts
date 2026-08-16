"use client";

import Dexie, { type EntityTable } from "dexie";

/**
 * The scanner's offline cache.
 *
 * Security note: this stores `tokenHash`, never the ticket token itself, and no
 * customer name, phone or email. A stolen gate device therefore leaks no
 * personal data and no reusable boarding credential (spec §7.2) — which is a
 * stronger guarantee than encrypting the tokens at rest would give.
 */
export type CachedTicket = {
  ticketId: string;
  tokenHash: string;
  bookingCode: string;
  status: "ACTIVE" | "USED" | "CANCELLED" | "EXPIRED";
  visitorCount: number;
  visitDate: string;
  usedAt: string | null;
};

/** A boarding recorded on the device, awaiting acknowledgement from the server. */
export type QueuedEvent = {
  clientEventId: string;
  ticketId: string;
  boardedCount: number;
  createdOffline: boolean;
  deviceReportedAt: string;
  attempts: number;
};

export type SyncMeta = {
  key: string;
  version: number;
  lastSyncAt: string | null;
  visitDate: string | null;
};

const db = new Dexie("lion-safari-scanner") as Dexie & {
  tickets: EntityTable<CachedTicket, "ticketId">;
  queue: EntityTable<QueuedEvent, "clientEventId">;
  meta: EntityTable<SyncMeta, "key">;
};

db.version(1).stores({
  tickets: "ticketId, tokenHash, status, visitDate",
  queue: "clientEventId, ticketId",
  meta: "key",
});

export { db as scannerDb };

const META_KEY = "sync";

export async function getMeta(): Promise<SyncMeta> {
  const row = await db.meta.get(META_KEY);
  return row ?? { key: META_KEY, version: 0, lastSyncAt: null, visitDate: null };
}

export async function setMeta(update: Partial<Omit<SyncMeta, "key">>): Promise<void> {
  const current = await getMeta();
  await db.meta.put({ ...current, ...update, key: META_KEY });
}

/** SHA-256 of the scanned QR text, to match against the cached hashes. */
export async function hashToken(token: string): Promise<string> {
  const bytes = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function findByToken(token: string): Promise<CachedTicket | undefined> {
  const hash = await hashToken(token);
  return db.tickets.where("tokenHash").equals(hash).first();
}

export async function applyTickets(tickets: CachedTicket[], fullSync: boolean): Promise<void> {
  await db.transaction("rw", db.tickets, async () => {
    // A full sync replaces the manifest so yesterday's tickets cannot linger.
    if (fullSync) await db.tickets.clear();
    if (tickets.length > 0) await db.tickets.bulkPut(tickets);
  });
}

/** Clears everything — used when a device is un-enrolled or the day rolls over. */
export async function resetScannerData(): Promise<void> {
  await db.transaction("rw", db.tickets, db.queue, db.meta, async () => {
    await db.tickets.clear();
    await db.queue.clear();
    await db.meta.clear();
  });
}
