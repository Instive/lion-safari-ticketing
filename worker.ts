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
import { log } from "@/lib/log";

/**
 * Logs a job's outcome, then lets the error (if any) continue on unchanged.
 *
 * A handler throw inside `boss.work()` is caught INSIDE pg-boss's own manager
 * and routed straight to its `fail()` bookkeeping — it never reaches
 * `boss.on('error', ...)` below, and pg-boss records the failure only as a row
 * in `pgboss.job`. So a ticket-delivery or daily-report job that fails every
 * retry was previously invisible outside a manual query against that table —
 * nothing about it ever reached Render's log stream. This wraps every job body
 * so success and failure are always logged with a duration, then rethrows so
 * pg-boss's own retry count, backoff and dead-lettering are exactly as before.
 */
async function runJob<T>(queue: string, job: { id: string }, fn: () => Promise<T>): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await fn();
    log.info("worker", "job succeeded", { queue, jobId: job.id, ms: Date.now() - startedAt });
    return result;
  } catch (err) {
    log.error("worker", "job failed", err, { queue, jobId: job.id, ms: Date.now() - startedAt });
    throw err;
  }
}

async function main() {
  const boss = await getBoss();
  boss.on("error", (err) => log.error("pg-boss", "internal error", err));
  log.info("worker", "started");

  await boss.work<DeliverTicketJob>(QUEUES.deliverTicket, { batchSize: 5 }, async (jobs) => {
    for (const job of jobs) {
      await runJob(QUEUES.deliverTicket, job, () => deliverTicket(job.data));
    }
  });

  await boss.work(QUEUES.reconcilePayments, { batchSize: 1 }, async (jobs) => {
    for (const job of jobs) {
      await runJob(QUEUES.reconcilePayments, job, async () => {
        const result = await reconcilePayments();
        if (result.checked > 0) {
          log.info("worker", "reconciled pending orders", {
            checked: result.checked,
            confirmed: result.confirmed,
          });
        }
        const purged = await purgeExpiredSessions();
        if (purged > 0) log.info("worker", "purged expired sessions", { purged });

        // Unsold blanks in a counter's ticket book are admissible at the gate
        // until they expire, so letting them survive a day rollover would
        // leave valid entry passes accumulating indefinitely. This is what
        // bounds a book's exposure to a single day (domain/booking/reserve.ts).
        const expired = await expireStaleBlanks({ type: "SYSTEM", id: "worker" });
        if (expired > 0) log.info("worker", "expired unsold ticket blanks", { expired });
      });
    }
  });

  await boss.work<DailyReportJob>(QUEUES.dailyReport, { batchSize: 1 }, async (jobs) => {
    for (const job of jobs) {
      await runJob(QUEUES.dailyReport, job, () => sendDailyReport(job.data));
    }
  });

  // Sweep every two minutes so a customer with a lost webhook waits minutes,
  // not until someone notices.
  await boss.schedule(QUEUES.reconcilePayments, "*/2 * * * *");

  // 8pm in the park's timezone — after the 5pm close, so the day is complete,
  // and while someone is still around to notice if it doesn't arrive. pg-boss
  // schedules in UTC unless told otherwise, which would land this mid-afternoon.
  await boss.schedule(QUEUES.dailyReport, "0 20 * * *", {}, { tz: env.APP_TIMEZONE });

  log.info("worker", "listening", { queues: Object.values(QUEUES).join(", ") });
}

async function shutdown(signal: string) {
  log.info("worker", "shutting down", { signal });
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

/*
 * Both handlers exit after logging, deliberately preserving today's behaviour
 * rather than softening it: Node already terminates the process on an
 * uncaught exception, and on an unhandled rejection too once nothing else is
 * listening for it. Installing a handler that does NOT exit would be a
 * regression dressed up as an improvement — it replaces "crash, and Render
 * restarts a clean process" with "log a line and keep running in whatever
 * state the failure left things." All this adds is one clearly labelled line
 * on the way down, so the log actually says why the restart is about to
 * happen instead of leaving Node's default unlabelled trace to explain it.
 */
process.on("unhandledRejection", (reason) => {
  log.error("worker", "unhandled promise rejection — exiting", reason);
  process.exit(1);
});
process.on("uncaughtException", (err) => {
  log.error("worker", "uncaught exception — exiting", err);
  process.exit(1);
});

main().catch((err) => {
  log.error("worker", "fatal — could not start", err);
  process.exit(1);
});
