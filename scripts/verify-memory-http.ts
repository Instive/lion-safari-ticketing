/** Production-build smoke checks; requires the disposable local test stack. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "@/db";
import { env } from "@/lib/env";
import { sha256 } from "@/lib/codes";
import { businessDate } from "@/lib/time";
import manifest from "@/lib/generated/image-manifest.json";
import { assertNotProduction } from "./lib/guard";

async function main() {
  assertNotProduction("verify memory HTTP routes");
  assert.equal(new URL(env.APP_BASE_URL).hostname, "127.0.0.1");
  assert.equal(new URL(env.DATABASE_URL).hostname, "127.0.0.1");
  assert.ok(new URL(env.DATABASE_URL).pathname.endsWith("_test"));
  const base = env.APP_BASE_URL;
  for (const path of ["/", "/gallery"]) {
    const response = await fetch(`${base}${path}`);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.ok(html.includes("/_images/"));
    assert.ok(!html.includes("/_next/image?"));
  }
  const image = await fetch(`${base}${manifest["/media/safari-hero.webp"][0]!.src}`);
  assert.equal(image.status, 200);
  assert.ok(image.headers.get("content-type")?.includes("image/webp"));
  assert.ok(image.headers.get("cache-control")?.includes("immutable"));
  await image.arrayBuffer();
  const optimizer = await fetch(`${base}/_next/image?url=%2Fmedia%2Fsafari-hero.webp&w=640&q=75`);
  assert.equal(optimizer.status, 404);
  console.log("PASS: public pages use static variants; immutable caching; runtime optimizer disabled");

  const prefix = `STATUS-${randomUUID().slice(0, 8).toUpperCase()}`;
  for (const status of ["PENDING", "PAID", "RESERVED"]) {
    const code = `${prefix}-${status}`;
    await pool.query(`insert into bookings(booking_code,channel,status,visitor_count,amount_total,per_visitor_paise,visit_date,idempotency_key)
      values ($1,$2,$3,1,$4,7500,$5,$1)`, [code, status === "RESERVED" ? "COUNTER" : "ONLINE", status, status === "RESERVED" ? 0 : 7500, businessDate()]);
    const response = await fetch(`${base}/api/ticket/${code}/status`, { headers: { "x-forwarded-for": `test-${prefix}` } });
    assert.equal(response.headers.get("cache-control"), "no-store");
    if (status === "RESERVED") assert.equal(response.status, 404);
    else {
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { status });
    }
  }
  const missing = await fetch(`${base}/api/ticket/${prefix}-MISSING/status`, { headers: { "x-forwarded-for": `test-${prefix}` } });
  assert.equal(missing.status, 404);
  const ip = `throttle-${randomUUID()}`;
  await pool.query("insert into rate_limits(key,points,expire) values ($1,20,$2)", [`ticket-lookup:${ip}`, Date.now() + 60_000]);
  const limited = await fetch(`${base}/api/ticket/${prefix}-PAID/status`, { headers: { "x-forwarded-for": ip } });
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get("retry-after")) > 0);
  console.log("PASS: payment status returns only status, hides unsold blanks, and enforces rate limits");

  const key = randomUUID();
  const { rows: [device] } = await pool.query("insert into devices(name,type,api_key_hash) values ('Memory HTTP scanner','SCANNER',$1) returning id", [sha256(key)]);
  const headers = { "x-device-key": key };
  const oldClient = await fetch(`${base}/api/scanner/sync?since=0`, { headers });
  assert.equal(oldClient.status, 426);
  const invalid = await fetch(`${base}/api/scanner/sync?protocol=2&since=-1`, { headers });
  assert.equal(invalid.status, 400);
  const first = await fetch(`${base}/api/scanner/sync?protocol=2&since=0`, { headers });
  assert.equal(first.status, 200);
  const page = await first.json();
  assert.ok(page.tickets.length <= 500);
  if (page.nextCursor) {
    const { rows: [state] } = await pool.query("select last_sync_version from devices where id=$1", [device.id]);
    assert.equal(Number(state.last_sync_version), 0);
    const tampered = await fetch(`${base}/api/scanner/sync?protocol=2&cursor=${page.nextCursor}x`, { headers });
    assert.equal(tampered.status, 409);
  }
  await pool.query("delete from devices where id=$1", [device.id]);
  await pool.query("delete from bookings where booking_code like $1", [`${prefix}-%`]);
  console.log("PASS: scanner protocol compatibility, bounded response, cursor validation and partial-sync watermark");
}
main().catch((err) => { console.error(err); process.exitCode = 1; }).finally(() => pool.end());
