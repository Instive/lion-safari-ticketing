import { expireStaleBlanks } from "@/domain/booking/reserve";
import { sendDailyReport, type DailyReportJob } from "@/jobs/handlers/daily-report";
import { deliverTicket } from "@/jobs/handlers/deliver-ticket";
import { reconcilePayments } from "@/jobs/handlers/reconcile-payments";
import { getBoss, QUEUES, type DeliverTicketJob } from "@/jobs/queue";
import { purgeExpiredSessions } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { log } from "@/lib/log";

/**
 * Registers every background job handler and schedule.
 *
 * Lives here rather than in `worker.ts` so the exact same code runs whether the
 * jobs are hosted by the standalone worker process or inside the web server —
 * see `RUN_WORKER_IN_WEB` in `lib/env.ts`. Two copies of this wiring that could
 * drift apart would be a much worse problem than the indirection: the whole
 * point is that "did this job run?" has one answer, not one per deployment
 * shape.
 */

/**
 * Logs a job's outcome, then lets the error (if any) continue on unchanged.
 *
 * A handler throw inside `boss.work()` is caught INSIDE pg-boss's own manager
 * and routed straight to its `fail()` bookkeeping — it never reaches
 * `boss.on('error', ...)`, and pg-boss records the failure only as a row in
 * `pgboss.job`. So a ticket-delivery or daily-report job that failed every
 * retry was invisible outside a manual query against that table. This wraps
 * every job body so success and failure always reach the log with a duration,
 * then rethrows so pg-boss's own retry count, backoff and dead-lettering are
 * exactly as before.
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

export async function startWorkers(): Promise<void> {
  const boss = await getBoss();
  boss.on("error", (err) => log.error("pg-boss", "internal error", err));

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
