/**
 * Background worker. Runs as its own process alongside the Next.js server:
 *   npm run worker
 *
 * Handles ticket delivery and payment reconciliation. Keeping it separate means
 * a slow email or an unresponsive payment API can never delay a web request.
 */
import { pool } from "@/db";
import { deliverTicket } from "@/jobs/handlers/deliver-ticket";
import { reconcilePayments } from "@/jobs/handlers/reconcile-payments";
import { getBoss, QUEUES, type DeliverTicketJob } from "@/jobs/queue";
import { purgeExpiredSessions } from "@/lib/auth/session";

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
  });

  // Sweep every two minutes so a customer with a lost webhook waits minutes,
  // not until someone notices.
  await boss.schedule(QUEUES.reconcilePayments, "*/2 * * * *");

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
