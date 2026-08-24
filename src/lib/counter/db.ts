"use client";

import Dexie, { type EntityTable } from "dexie";

/**
 * The counter's offline store: the ticket book it can sell from, and the sales
 * waiting to reach the server.
 *
 * Security note, and it differs from the scanner's on purpose: this DOES hold
 * raw ticket tokens, because the counter has to print them onto tickets. The
 * scanner never needs the token — only a hash to match a scan against — so it
 * never gets one. That asymmetry is why a counter device's book is bound to
 * that device, kept small, dated, and reconciled daily.
 */
export type Blank = {
  bookingId: string;
  bookingCode: string;
  token: string;
  visitorCount: number;
  visitDate: string;
};

/** A sale made against a blank, waiting to be reconciled with the server. */
export type QueuedSale = {
  /** The blank that was sold — also the idempotency key for the whole sale. */
  bookingId: string;
  bookingCode: string;
  visitorCount: number;
  visitDate: string;
  /** Priced by the server on reconciliation; held here only to print and total. */
  perVisitorPaise: number;
  amountTotal: number;
  rateCategoryId: string | null;
  customRatePaise: number | null;
  rateNote: string | null;
  /** Cash or UPI, as tapped on the till. */
  tender: "CASH" | "UPI";
  customerName: string | null;
  customerPhone: string | null;
  staffId: string | null;
  /** Device clock at the moment of sale. Audit only. */
  soldOfflineAt: string;
  attempts: number;
};

export type CounterMeta = {
  key: string;
  lastSyncAt: string | null;
  /** The park day the server last reported, so the UI never guesses it. */
  visitDate: string | null;
};

const db = new Dexie("lion-safari-counter") as Dexie & {
  blanks: EntityTable<Blank, "bookingId">;
  queue: EntityTable<QueuedSale, "bookingId">;
  meta: EntityTable<CounterMeta, "key">;
};

db.version(1).stores({
  blanks: "bookingId, visitDate, visitorCount",
  queue: "bookingId, visitDate",
  meta: "key",
});

export { db as counterDb };

const META_KEY = "counter";

export async function getCounterMeta(): Promise<CounterMeta> {
  const row = await db.meta.get(META_KEY);
  return row ?? { key: META_KEY, lastSyncAt: null, visitDate: null };
}

export async function setCounterMeta(update: Partial<Omit<CounterMeta, "key">>): Promise<void> {
  const current = await getCounterMeta();
  await db.meta.put({ ...current, ...update, key: META_KEY });
}

/**
 * Replaces the book with what the server just sent.
 *
 * Anything already queued as sold is kept out, because the server has not been
 * told about those sales yet and still reports them as unsold — re-adding them
 * would let the same blank be handed to a second guest.
 */
export async function applyBook(blanks: Blank[]): Promise<void> {
  await db.transaction("rw", db.blanks, db.queue, async () => {
    const soldIds = new Set((await db.queue.toArray()).map((s) => s.bookingId));
    await db.blanks.clear();
    const unsold = blanks.filter((b) => !soldIds.has(b.bookingId));
    if (unsold.length > 0) await db.blanks.bulkPut(unsold);
  });
}

/** How many blanks are left, per group size, for one visit date. */
export async function stockFor(visitDate: string): Promise<Map<number, number>> {
  const rows = await db.blanks.where("visitDate").equals(visitDate).toArray();
  const stock = new Map<number, number>();
  for (const row of rows) {
    stock.set(row.visitorCount, (stock.get(row.visitorCount) ?? 0) + 1);
  }
  return stock;
}

/**
 * Takes one blank of the requested size out of the book, atomically.
 *
 * The delete and the queue insert happen in a single Dexie transaction so a
 * crash between them cannot either lose the sale or leave the blank available
 * to be sold twice.
 */
export async function claimBlank(
  visitDate: string,
  visitorCount: number,
  sale: Omit<QueuedSale, "bookingId" | "bookingCode" | "visitorCount" | "visitDate">,
): Promise<{ blank: Blank; queued: QueuedSale } | null> {
  return db.transaction("rw", db.blanks, db.queue, async () => {
    const blank = await db.blanks
      .where("visitDate")
      .equals(visitDate)
      .and((b) => b.visitorCount === visitorCount)
      .first();

    if (!blank) return null;

    const queued: QueuedSale = {
      ...sale,
      bookingId: blank.bookingId,
      bookingCode: blank.bookingCode,
      visitorCount: blank.visitorCount,
      visitDate: blank.visitDate,
    };

    await db.blanks.delete(blank.bookingId);
    await db.queue.put(queued);

    return { blank, queued };
  });
}

export async function clearCounterData(): Promise<void> {
  await db.transaction("rw", db.blanks, db.queue, db.meta, async () => {
    await db.blanks.clear();
    await db.queue.clear();
    await db.meta.clear();
  });
}
