/**
 * Background worker, as its own process:
 *   npm run worker
 *
 * Handles ticket delivery, payment reconciliation and the nightly report.
 * Keeping it separate means a slow email or an unresponsive payment API can
 * never delay a web request.
 *
 * That isolation costs a whole paid instance, though, which is a lot for a
 * park whose jobs are almost all awaited network calls. `RUN_WORKER_IN_WEB`
 * (see lib/env.ts) hosts the very same handlers inside the web server instead,
 * so this process can be deleted to halve the hosting bill. Both paths call
 * `startWorkers()` — there is deliberately only one copy of the job wiring.
 */
import { pool } from "@/db";
import { startWorkers } from "@/jobs/start-workers";
import { env } from "@/lib/env";
import { log } from "@/lib/log";

async function main() {
  if (env.RUN_WORKER_IN_WEB) {
    // Both hosts running the same schedules would not corrupt anything —
    // pg-boss locks each job row, and every handler here is already idempotent
    // — but it doubles the polling against the database for no benefit, and
    // makes "which process ran this?" unanswerable from the logs. Refuse
    // instead, so the deployment shape stays a single deliberate choice.
    log.error(
      "worker",
      "refusing to start: RUN_WORKER_IN_WEB is true, so the web service is " +
        "already running these jobs. Unset it to run a standalone worker, or " +
        "delete this service.",
    );
    process.exit(1);
  }

  log.info("worker", "started");
  await startWorkers();
}

async function shutdown(signal: string) {
  log.info("worker", "shutting down", { signal });
  try {
    const { getBoss } = await import("@/jobs/queue");
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
