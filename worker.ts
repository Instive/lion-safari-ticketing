/**
 * Background worker. Runs as its own process alongside the Next.js server:
 *   npm run worker
 *
 * Handles ticket delivery and payment reconciliation. Keeping it separate means
 * a slow email or an unresponsive payment API can never delay a web request.
 */
import { pool } from "@/db";
import { expireStaleBlanks } from "@/domain/booking/reserve";
import { sendDailyReport, type DailyReportJob } from "@/jobs/handlers/daily-report";
import { deliverTicket } from "@/jobs/handlers/deliver-ticket";
import { reconcilePayments } from "@/jobs/handlers/reconcile-payments";
import { getBoss, QUEUES, type DeliverTicketJob } from "@/jobs/queue";
import { purgeExpiredSessions } from "@/lib/auth/session";
import { env } from "@/lib/env";

async function main() {
  const boss = await getBoss();
  console.info("[worker] started");

  await boss.work<DeliverTicketJob>(QUEUES.deliverTicket, { batchSize: 5 }, async (jobs) => {
    for (const job of jobs) {
      await deliverTicket(job.data);
    }
  });

  await boss.work(QUEUES.reconcilePayments, { batchSize: 1 }, async () => {
    const result = await reconcilePayments();
    if (result.checked > 0) {
      console.info(`[worker] reconciled ${result.checked} pending order(s), confirmed ${result.confirmed}`);
    }
    const purged = await purgeExpiredSessions();
    if (purged > 0) console.info(`[worker] purged ${purged} expired session(s)`);

    // Unsold blanks in a counter's ticket book are admissible at the gate until
    // they expire, so letting them survive a day rollover would leave valid
    // entry passes accumulating indefinitely. This is what bounds a book's
    // exposure to a single day (see domain/booking/reserve.ts).
    const expired = await expireStaleBlanks({ type: "SYSTEM", id: "worker" });
    if (expired > 0) console.info(`[worker] expired ${expired} unsold ticket blank(s)`);
  });

  await boss.work<DailyReportJob>(QUEUES.dailyReport, { batchSize: 1 }, async (jobs) => {
    for (const job of jobs) {
      await sendDailyReport(job.data);
    }
  });

  // Sweep every two minutes so a customer with a lost webhook waits minutes,
  // not until someone notices.
  await boss.schedule(QUEUES.reconcilePayments, "*/2 * * * *");

  // 8pm in the park's timezone — after the 5pm close, so the day is complete,
  // and while someone is still around to notice if it doesn't arrive. pg-boss
  // schedules in UTC unless told otherwise, which would land this mid-afternoon.
  await boss.schedule(QUEUES.dailyReport, "0 20 * * *", {}, { tz: env.APP_TIMEZONE });

  console.info("[worker] listening on:", Object.values(QUEUES).join(", "));
}

async function shutdown(signal: string) {
  console.info(`[worker] ${signal} received, shutting down`);
  try {
    const boss = await getBoss();
    await boss.stop({ graceful: true });
  } finally {
    await pool.end();
    process.exit(0);
  }
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

main().catch((err) => {
  console.error("[worker] fatal", err);
  process.exit(1);
});
