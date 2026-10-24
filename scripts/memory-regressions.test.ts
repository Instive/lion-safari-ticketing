import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { test, after } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { streamBytes } from "@/lib/stream";
import { singleFlight } from "@/lib/single-flight";
import { fetchJson } from "@/lib/fetch-json";
import { decodeSyncCursor, encodeSyncCursor } from "@/domain/scanner/cursor";
import { scannerDb, getMeta, setMeta, resetScannerData, type CachedTicket } from "@/lib/scanner/db";
import { runSync } from "@/lib/scanner/sync-client";
import staticImageLoader from "@/lib/static-image-loader";
import manifest from "@/lib/generated/image-manifest.json";
import { access } from "node:fs/promises";

const realFetch = globalThis.fetch;
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
  getItem: () => "test-device", setItem: () => {}, removeItem: () => {},
} });
after(() => { globalThis.fetch = realFetch; scannerDb.close(); });

test("CSV waits for a reader, bounds production, and releases the generator on cancellation", async () => {
  let produced = 0;
  let closed = false;
  async function* chunks() {
    try {
      for (let i = 0; i < 1000; i++) { produced++; yield new Uint8Array(1024); }
    } finally { closed = true; }
  }
  const reader = streamBytes(chunks()).getReader();
  await sleep(10);
  assert.equal(produced, 0);
  assert.equal((await reader.read()).value?.length, 1024);
  await sleep(10);
  assert.equal(produced, 1, "a slow reader must not queue the remaining export");
  await reader.cancel();
  assert.equal(closed, true);
  assert.equal(produced, 1);
});

test("aborting a download during a batch stops later production", async () => {
  const abort = new AbortController();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  let closed = false;
  async function* chunks() {
    try { await pending; yield new Uint8Array(10); assert.fail("produced after abort"); }
    finally { closed = true; }
  }
  const reader = streamBytes(chunks(), abort.signal).getReader();
  const read = reader.read();
  await sleep(0);
  abort.abort();
  await assert.rejects(read);
  release();
  await sleep(0);
  assert.equal(closed, true);
});

test("concurrent polling triggers share work and recover after failure", async () => {
  let calls = 0;
  const run = singleFlight(async () => { calls++; await sleep(5); if (calls === 1) throw new Error("offline"); return calls; });
  const results = await Promise.allSettled([run(), run(), run()]);
  assert.equal(calls, 1);
  assert.ok(results.every((r) => r.status === "rejected"));
  assert.equal(await run(), 2);
});

test("request deadlines cover body reads and caller cancellation", async () => {
  globalThis.fetch = async (_url, init) => new Response(new ReadableStream({
    start(controller) {
      const abort = () => controller.error(init!.signal!.reason);
      if (init?.signal?.aborted) abort();
      else init?.signal?.addEventListener("abort", abort, { once: true });
    },
  }));
  await assert.rejects(fetchJson("/slow-body", {}, 10), /timed out/);
  const controller = new AbortController();
  const request = fetchJson("/slow-body", { signal: controller.signal });
  controller.abort(new Error("page closed"));
  await assert.rejects(request, /page closed/);
  globalThis.fetch = realFetch;
});

test("scanner cursors reject tampering, expiry and day rollover", () => {
  const cursor = { since: 10, version: 20, visitDate: "2026-10-24", startedAt: "2026-10-24T03:00:00.000Z", overlapFrom: "2026-10-24T02:59:30.000Z", after: "11111111-1111-4111-8111-111111111111", fullSync: true };
  const encoded = encodeSyncCursor(cursor, "test-secret");
  assert.deepEqual(decodeSyncCursor(encoded, "test-secret", cursor.visitDate, new Date(cursor.startedAt)), cursor);
  assert.throws(() => decodeSyncCursor(encoded + "x", "test-secret", cursor.visitDate, new Date(cursor.startedAt)));
  assert.throws(() => decodeSyncCursor(encoded, "test-secret", cursor.visitDate, new Date("2026-10-24T03:16:00Z")));
  assert.throws(() => decodeSyncCursor(encoded, "test-secret", "2026-10-25", new Date(cursor.startedAt)));
});

const today = "2026-10-24";
const ticket = (id: string, status: CachedTicket["status"] = "ACTIVE"): CachedTicket => ({ ticketId: id, tokenHash: id, bookingCode: id, status, visitorCount: 1, visitDate: today, usedAt: null });
const page = (tickets: CachedTicket[], nextCursor: string | null, fullSync = true) => Response.json({ tickets, nextCursor, fullSync, version: 100, serverTime: "2026-10-24T03:00:00.000Z", visitDate: today, staleThresholdSeconds: 300 });

test("failed full sync preserves the completed manifest and watermark; retry publishes all pages atomically", async () => {
  await resetScannerData();
  await scannerDb.tickets.put(ticket("old"));
  await setMeta({ version: 10, visitDate: today, lastSyncAt: "2026-10-24T02:00:00.000Z" });
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) return page([ticket("a")], "page-2");
    assert.equal(await scannerDb.tickets.count(), 1);
    assert.ok(await scannerDb.tickets.get("old"));
    assert.equal((await getMeta()).version, 10);
    return new Response("outage", { status: 503 });
  };
  await assert.rejects(runSync(), /503/);
  assert.ok(await scannerDb.tickets.get("old"));
  assert.equal((await getMeta()).version, 10);
  assert.equal(await scannerDb.staging.count(), 0);
  calls = 0;
  globalThis.fetch = async () => ++calls === 1 ? page([ticket("a")], "page-2") : page([ticket("b")], null);
  await Promise.all([runSync(), runSync()]);
  assert.equal(calls, 2);
  assert.deepEqual(await scannerDb.tickets.orderBy("ticketId").primaryKeys(), ["a", "b"]);
  assert.equal((await getMeta()).version, 100);
});

test("a boarding recorded during a full download is not revived by its earlier page", async () => {
  await resetScannerData();
  await scannerDb.tickets.put(ticket("a"));
  let calls = 0;
  globalThis.fetch = async () => {
    if (++calls === 1) return page([ticket("a")], "page-2");
    // Another scan consumed this ticket after page one was staged.
    await scannerDb.tickets.update("a", { status: "USED" });
    return page([ticket("b")], null);
  };
  await runSync();
  assert.equal((await scannerDb.tickets.get("a"))?.status, "USED");
});

test("a failed rollover blocks yesterday's manifest without advancing freshness", async () => {
  await resetScannerData();
  await setMeta({ version: 10, visitDate: "2026-10-23", lastSyncAt: "2026-10-23T03:00:00.000Z" });
  let calls = 0;
  globalThis.fetch = async () => ++calls === 1 ? page([ticket("a")], "page-2") : new Response(null, { status: 503 });
  await assert.rejects(runSync());
  assert.equal((await getMeta()).visitDate, null);
  assert.equal((await getMeta()).version, 0);
});

test("image loader uses generated files for responsive sizes, never the runtime optimizer", async () => {
  for (const [src, variants] of Object.entries(manifest)) {
    for (const width of [32, 375, 750, 1440, 3840]) {
      const url = staticImageLoader({ src, width });
      assert.ok(url.startsWith("/_images/"));
      assert.ok(variants.some((v) => v.src === url));
      await access(`public${url}`);
    }
  }
  assert.equal(staticImageLoader({ src: "/logo.svg", width: 100 }), "/logo.svg");
});
