import { PgBoss } from "pg-boss";

import { env } from "@/lib/env";

export const QUEUES = {
  deliverTicket: "deliver-ticket",
  reconcilePayments: "reconcile-payments",
  dailyReport: "daily-report",
} as const;

export type DeliverTicketJob = { bookingId: string };

/**
 * pg-boss runs on the same Postgres as the app — one less service to operate,
 * and jobs commit with the same durability as the data they act on.
 */
const globalForBoss = globalThis as unknown as { __boss?: PgBoss; __bossStarting?: Promise<PgBoss> };

export async function getBoss(): Promise<PgBoss> {
  if (globalForBoss.__boss) return globalForBoss.__boss;
  if (globalForBoss.__bossStarting) return globalForBoss.__bossStarting;

  globalForBoss.__bossStarting = (async () => {
    const boss = new PgBoss({
      connectionString: env.DATABASE_URL,
      schema: "pgboss",
    });
    boss.on("error", (err) => console.error("[pg-boss]", err));
    await boss.start();

    await Promise.all([
      // Delivery keeps retrying with backoff for roughly a day: a customer's
      // ticket email should survive a long outage at the mail provider.
      boss.createQueue(QUEUES.deliverTicket, {
        retryLimit: 8,
        retryDelay: 30,
        retryBackoff: true,
        retryDelayMax: 3600,
        // Keep finished jobs around long enough to investigate a complaint.
        deleteAfterSeconds: 60 * 60 * 24 * 7,
      }),
      boss.createQueue(QUEUES.reconcilePayments, {
        retryLimit: 2,
        retryDelay: 60,
        deleteAfterSeconds: 60 * 60 * 24 * 7,
      }),
      // A missed evening report is worth retrying for a while — a mail provider
      // outage should not cost the day's record.
      boss.createQueue(QUEUES.dailyReport, {
        retryLimit: 6,
        retryDelay: 300,
        retryBackoff: true,
        retryDelayMax: 3600,
        deleteAfterSeconds: 60 * 60 * 24 * 7,
      }),
    ]);
    globalForBoss.__boss = boss;
    return boss;
  })();

  return globalForBoss.__bossStarting;
}

/**
 * Queues ticket delivery. Safe to call more than once for the same booking:
 * the handler regenerates from the existing ticket and never issues a new one.
 */
export async function enqueueTicketDelivery(bookingId: string): Promise<void> {
  const boss = await getBoss();
  await boss.send(QUEUES.deliverTicket, { bookingId } satisfies DeliverTicketJob, {
    // Collapses duplicate enqueues for the same booking within the window, so a
    // webhook and the reconciliation sweep cannot send two emails.
    singletonKey: bookingId,
    singletonSeconds: 60,
  });
}

/**
 * Queues the bookings report for one business date. Safe to call repeatedly:
 * the date is the singleton key, so the nightly schedule and an admin pressing
 * "email it again" within the window collapse into one send.
 */
export async function enqueueDailyReport(
  businessDate: string,
  options: { singletonSeconds?: number } = {},
): Promise<void> {
  const boss = await getBoss();
  await boss.send(
    QUEUES.dailyReport,
    { businessDate },
    {
      singletonKey: businessDate,
      singletonSeconds: options.singletonSeconds ?? 300,
    },
  );
}
