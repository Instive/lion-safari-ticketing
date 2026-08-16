import { and, eq, sql } from "drizzle-orm";
import Link from "next/link";

import { db } from "@/db";
import { boardingEvents, bookings, devices, paymentEvents } from "@/db/schema";
import { requirePageStaff } from "@/lib/auth/guards";
import { formatPaise } from "@/lib/money";
import { businessDate, formatLocalTime, formatVisitDate } from "@/lib/time";

export const metadata = { title: "Admin — Lion Safari" };
export const dynamic = "force-dynamic";

export default async function AdminDashboard() {
  await requirePageStaff(["ADMIN"]);
  const today = businessDate();
  // Windows are computed by the database so every screen agrees on "now".
  const dayStart = sql`now() - interval '24 hours'`;

  const [todayStats] = await db
    .select({
      bookingCount: sql<number>`count(*)::int`,
      visitors: sql<number>`coalesce(sum(${bookings.visitorCount}), 0)::int`,
      revenue: sql<number>`coalesce(sum(${bookings.amountTotal}), 0)::int`,
      online: sql<number>`count(*) filter (where ${bookings.channel} = 'ONLINE')::int`,
      counter: sql<number>`count(*) filter (where ${bookings.channel} = 'COUNTER')::int`,
    })
    .from(bookings)
    .where(
      and(
        eq(bookings.visitDate, today),
        sql`${bookings.status} in ('PAID', 'CASH_CONFIRMED')`,
      ),
    );

  const [boardingStats] = await db
    .select({
      events: sql<number>`count(*)::int`,
      boarded: sql<number>`coalesce(sum(${boardingEvents.boardedCount}), 0)::int`,
    })
    .from(boardingEvents)
    .where(sql`${boardingEvents.boardedAt} >= ${dayStart}`);

  const [pendingStats] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(bookings)
    .where(and(eq(bookings.status, "PENDING"), sql`${bookings.createdAt} >= ${dayStart}`));

  const [mismatchStats] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(paymentEvents)
    .where(sql`${paymentEvents.processingError} is not null`);

  // Staleness is evaluated against the database clock, not the render's clock.
  const scanners = await db
    .select({
      id: devices.id,
      name: devices.name,
      active: devices.active,
      lastSyncAt: devices.lastSyncAt,
      stale: sql<boolean>`(${devices.lastSyncAt} is null or ${devices.lastSyncAt} < now() - interval '5 minutes')`,
    })
    .from(devices)
    .where(eq(devices.type, "SCANNER"));

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6">
      <div className="mb-6 flex items-baseline justify-between">
        <div>
          <h1 className="text-xl font-semibold">Today</h1>
          <p className="text-muted text-sm">{formatVisitDate(today)}</p>
        </div>
        <nav className="flex gap-3 text-sm">
          <Link href="/admin/bookings" className="text-brand underline">
            Bookings
          </Link>
          <Link href="/admin/reconciliation" className="text-brand underline">
            Reconciliation
          </Link>
          <Link href="/admin/devices" className="text-brand underline">
            Devices
          </Link>
          <Link href="/admin/staff" className="text-brand underline">
            Staff
          </Link>
        </nav>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Confirmed bookings" value={String(todayStats?.bookingCount ?? 0)} />
        <Stat label="Visitors expected" value={String(todayStats?.visitors ?? 0)} />
        <Stat label="Revenue" value={formatPaise(todayStats?.revenue ?? 0)} />
        <Stat
          label="Boarded (24h)"
          value={`${boardingStats?.boarded ?? 0}`}
          hint={`${boardingStats?.events ?? 0} scans`}
        />
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Stat
          label="Online / counter split"
          value={`${todayStats?.online ?? 0} / ${todayStats?.counter ?? 0}`}
        />
        <Stat
          label="Awaiting payment (24h)"
          value={String(pendingStats?.count ?? 0)}
          hint="Reconciliation sweeps these automatically"
        />
      </div>

      {(mismatchStats?.count ?? 0) > 0 ? (
        <Link
          href="/admin/reconciliation"
          className="mt-4 block rounded-xl border border-danger/40 bg-danger/5 p-4"
        >
          <p className="font-semibold text-danger">
            {mismatchStats!.count} payment event(s) need review
          </p>
          <p className="text-muted text-sm">
            These did not confirm a booking — usually an amount mismatch or an unknown order.
          </p>
        </Link>
      ) : null}

      <section className="mt-8">
        <h2 className="mb-3 font-semibold">Gate scanners</h2>
        <div className="space-y-2">
          {scanners.length === 0 ? (
            <p className="text-muted rounded-xl border border-line bg-surface p-4 text-sm">
              No scanner registered yet.{" "}
              <Link href="/admin/devices" className="text-brand underline">
                Register one
              </Link>
              .
            </p>
          ) : (
            scanners.map((d) => {
              return (
                <div
                  key={d.id}
                  className="flex items-center justify-between rounded-xl border border-line bg-surface p-4"
                >
                  <div>
                    <p className="font-medium">{d.name}</p>
                    <p className="text-muted text-sm">
                      {d.lastSyncAt
                        ? `Last sync ${formatLocalTime(d.lastSyncAt)}`
                        : "Never synced"}
                    </p>
                  </div>
                  <span
                    className={`rounded-lg px-2 py-1 text-xs font-semibold ${
                      !d.active
                        ? "bg-danger/10 text-danger"
                        : d.stale
                          ? "bg-accent/10 text-accent"
                          : "bg-ok/10 text-ok"
                    }`}
                  >
                    {!d.active ? "Deactivated" : d.stale ? "Stale" : "Synced"}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </section>
    </main>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <p className="text-muted text-sm">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
      {hint ? <p className="text-muted mt-1 text-xs">{hint}</p> : null}
    </div>
  );
}
