/** Regression checks against a dedicated, disposable local database only. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PgBoss } from "pg-boss";
import { pool } from "@/db";
import { buildSync, SYNC_PAGE_SIZE } from "@/domain/scanner/sync";
import { getBoss, QUEUES } from "@/jobs/queue";
import { env } from "@/lib/env";
import { businessDate } from "@/lib/time";
import { assertNotProduction } from "./lib/guard";

async function main() {
  assertNotProduction("verify memory regression scenarios");
  const target = new URL(env.DATABASE_URL);
  assert.ok(["127.0.0.1", "localhost"].includes(target.hostname) && target.pathname.endsWith("_test"),
    "This fixture-heavy test requires a disposable local database ending in _test");
  const prefix = `MEM-${randomUUID()}`;
  const today = businessDate();
  await pool.query("insert into change_log(entity,entity_id,operation) values ('booking',$1,'INSERT')", [randomUUID()]);
  const { rows: [watermark] } = await pool.query("select max(id)::float8 as version from change_log");
  const { rows: created } = await pool.query(`
    insert into bookings(booking_code, channel, status, visitor_count, amount_total, per_visitor_paise, visit_date, idempotency_key)
    select $1 || '-' || i, 'COUNTER', 'CASH_CONFIRMED', 1, 7500, 7500, $2::date, $1 || '-' || i
    from generate_series(1, 5501) i returning id`, [prefix, today]);
  const ids = created.map((r) => r.id);
  await pool.query(`insert into tickets(booking_id,token,visitor_count,visit_date)
    select id, id::text, 1, visit_date from bookings where id=any($1::uuid[])`, [ids]);
  await pool.query(`insert into change_log(entity,entity_id,operation,created_at)
    select 'ticket',id,'INSERT',now()-interval '10 minutes' from tickets where booking_id=any($1::uuid[])`, [ids]);

  const first = await buildSync(0, 300, { visitDate: "2020-01-01" });
  assert.equal(first.tickets.length, SYNC_PAGE_SIZE);
  assert.ok(first.nextCursor);
  const changed = first.tickets[0]!.ticketId;
  await pool.query("update tickets set status='USED',used_at=now() where id=$1", [changed]);
  await pool.query("insert into change_log(entity,entity_id,operation) values ('ticket',$1,'UPDATE')", [changed]);
  const lateId = `00000000-0000-4000-8000-${randomUUID().slice(-12)}`;
  const { rows: [lateBooking] } = await pool.query(`insert into bookings(booking_code,channel,status,visitor_count,amount_total,per_visitor_paise,visit_date,idempotency_key)
    values ($1,'COUNTER','CASH_CONFIRMED',1,7500,7500,$2,$1) returning id`, [`${prefix}-late`, today]);
  ids.push(lateBooking.id);
  await pool.query("insert into tickets(id,booking_id,token,visitor_count,visit_date) values ($1::uuid,$2,$1::uuid::text,1,$3)", [lateId, lateBooking.id, today]);
  await pool.query("insert into change_log(entity,entity_id,operation) values ('ticket',$1,'INSERT')", [lateId]);

  const seen = new Set(first.tickets.map((t) => t.ticketId));
  let cursor: string | null = first.nextCursor;
  while (cursor) {
    const page = await buildSync(0, 300, { cursor });
    assert.ok(page.tickets.length <= SYNC_PAGE_SIZE);
    assert.equal(page.version, first.version);
    for (const t of page.tickets) { assert.ok(!seen.has(t.ticketId)); seen.add(t.ticketId); }
    cursor = page.nextCursor;
  }
  const followup = await buildSync(first.version, 300, { visitDate: today, syncedAt: first.serverTime });
  assert.ok(followup.tickets.some((t) => t.ticketId === lateId), "insert behind the cursor is replayed next sync");
  // Collect the whole delta: changes can sort after any unrelated overlap rows.
  const delta = [...followup.tickets];
  cursor = followup.nextCursor;
  while (cursor) {
    const page = await buildSync(first.version, 300, { cursor });
    delta.push(...page.tickets); cursor = page.nextCursor;
  }
  assert.equal(delta.find((t) => t.ticketId === changed)?.status, "USED");

  const allDelta = await buildSync(watermark.version, 300, { visitDate: today });
  const deltaIds = new Set(allDelta.tickets.map((t) => t.ticketId));
  cursor = allDelta.nextCursor;
  while (cursor) {
    const page = await buildSync(watermark.version, 300, { cursor });
    assert.ok(page.tickets.length <= SYNC_PAGE_SIZE);
    for (const t of page.tickets) deltaIds.add(t.ticketId);
    cursor = page.nextCursor;
  }
  const { rows: fixtureTickets } = await pool.query("select id from tickets where booking_id=any($1::uuid[])", [ids]);
  assert.equal(fixtureTickets.filter((t) => deltaIds.has(t.id)).length, 5502, "deltas beyond 5,000 changes must not be lost");
  const rollover = await buildSync(first.version, 300, { visitDate: "2020-01-01" });
  assert.equal(rollover.fullSync, true);
  console.log("PASS: bounded full/delta pages, >5,000 changes, concurrent insert/update, and date rollover");

  const legacy = new PgBoss({ connectionString: env.DATABASE_URL, schema: "pgboss" });
  await legacy.start();
  await legacy.createQueue("daily-report");
  await legacy.schedule("daily-report", "0 20 * * *");
  await legacy.schedule("daily-report", "0 19 * * *", {}, { key: "old-extra-key" });
  await legacy.send("daily-report", { businessDate: today });
  await legacy.stop();
  const boss = await getBoss();
  try {
    assert.equal((await boss.getSchedules("daily-report")).length, 0);
    assert.equal(await boss.getQueue("daily-report"), null);
    assert.ok(await boss.getQueue(QUEUES.deliverTicket));
    assert.ok(await boss.getQueue(QUEUES.reconcilePayments));
    console.log("PASS: persisted report schedules/jobs removed; ticket and reconciliation queues preserved");
  } finally { await boss.stop(); }

  await pool.query("delete from change_log where entity_id in (select id from tickets where booking_id=any($1::uuid[]))", [ids]);
  await pool.query("delete from tickets where booking_id=any($1::uuid[])", [ids]);
  await pool.query("delete from bookings where id=any($1::uuid[])", [ids]);
}

main().catch((err) => { console.error(err); process.exitCode = 1; }).finally(() => pool.end());
