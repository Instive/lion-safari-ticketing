import { and, eq, sql } from "drizzle-orm";
import Link from "next/link";

import { db } from "@/db";
import { boardingEvents, bookings, devices, paymentEvents } from "@/db/schema";
import { requirePageStaff } from "@/lib/auth/guards";
import { formatPaise } from "@/lib/money";
import { businessDate, formatLocalTime, formatVisitDate } from "@/lib/time";

export const metadata = { title: "Admin — Lion Safari" };
export const dynamic = "force-dynamic";

const SECTIONS = [
  { href: "/admin/bookings", label: "Bookings" },
  { href: "/admin/rates", label: "Rates" },
  { href: "/admin/books", label: "Ticket books" },
  { href: "/admin/reconciliation", label: "Reconciliation" },
  { href: "/admin/devices", label: "Devices" },
  { href: "/admin/staff", label: "Staff" },
];

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
      // Split by how the money arrived, because the two are reconciled against
      // different documents: cash against the drawer, UPI against the account
      // statement. Online takings are neither — they clear through the gateway.
      cashTaken: sql<number>`coalesce(sum(${bookings.amountTotal}) filter (where ${bookings.counterTender} = 'CASH'), 0)::int`,
      upiTaken: sql<number>`coalesce(sum(${bookings.amountTotal}) filter (where ${bookings.counterTender} = 'UPI'), 0)::int`,
      onlineTaken: sql<number>`coalesce(sum(${bookings.amountTotal}) filter (where ${bookings.channel} = 'ONLINE'), 0)::int`,
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

  const expected = todayStats?.visitors ?? 0;
  const boarded = boardingStats?.boarded ?? 0;
  const online = todayStats?.online ?? 0;
  const counter = todayStats?.counter ?? 0;
  const needsReview = mismatchStats?.count ?? 0;
  const cashTaken = todayStats?.cashTaken ?? 0;
  const upiTaken = todayStats?.upiTaken ?? 0;
  const onlineTaken = todayStats?.onlineTaken ?? 0;

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-muted text-xs font-medium uppercase tracking-[0.14em]">Today</p>
          <h1 className="mt-1 text-2xl font-semibold">{formatVisitDate(today)}</h1>
        </div>
        <nav className="flex flex-wrap gap-2">
          {SECTIONS.map((s) => (
            <Link
              key={s.href}
              href={s.href}
              className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium transition-colors hover:border-brand hover:text-brand"
            >
              {s.label}
            </Link>
          ))}
        </nav>
      </div>

      {/* The one thing that needs a person, surfaced above the numbers rather
          than below them — a payment event that did not confirm a booking is
          money in limbo, and it should not sit under a fold. */}
      {needsReview > 0 ? (
        <Link
          href="/admin/reconciliation"
          className="mt-6 flex items-start gap-3 rounded-xl border border-danger/40 bg-danger/5 p-4 transition-colors hover:border-danger"
        >
          <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-danger text-xs font-bold text-white">
            !
          </span>
          <span>
            <span className="block font-semibold text-danger">
              {needsReview} payment {needsReview === 1 ? "event needs" : "events need"} review
            </span>
            <span className="text-muted mt-0.5 block text-sm">
              These did not confirm a booking — usually an amount mismatch or an unknown order.
            </span>
          </span>
        </Link>
      ) : null}

      <div className="mt-6 grid gap-3 lg:grid-cols-3">
        <Stat
          label="Revenue"
          value={formatPaise(todayStats?.revenue ?? 0)}
          hint={`${todayStats?.bookingCount ?? 0} confirmed ${
            (todayStats?.bookingCount ?? 0) === 1 ? "booking" : "bookings"
          }`}
          emphasis
        />
        <Stat label="Visitors expected" value={String(expected)} hint="Across all confirmed bookings" />
        <Stat
          label="Awaiting payment"
          value={String(pendingStats?.count ?? 0)}
          hint="Last 24h · reconciliation sweeps these"
        />
      </div>

      {/*
        Split by how the money actually arrived, because each part is reconciled
        against a different document: cash against the drawer, UPI against the
        account statement, online against the gateway's own settlement report.
        A single revenue figure can only be checked against the sum of three
        things nobody has in front of them at once.

        Worth being clear about what the counter figures are and are not: staff
        tapping "UPI received" is exactly as unverified as tapping "Cash
        received" — the app has no line to the bank and cannot see a transfer
        land. These are what staff said they took, which is the thing the
        statement gets checked against, not a substitute for checking it.
      */}
      <section className="mt-3 rounded-xl border border-line bg-surface p-4">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-muted text-sm">Today&rsquo;s takings, by how it was paid</h2>
          <Link href="/admin/bookings" className="text-brand shrink-0 text-xs underline">
            Detail &amp; export
          </Link>
        </div>
        <dl className="mt-3 grid gap-3 sm:grid-cols-3">
          <Taking label="Cash" value={formatPaise(cashTaken)} hint="Counter · check the drawer" />
          <Taking label="UPI" value={formatPaise(upiTaken)} hint="Counter · check the statement" />
          <Taking
            label="Online"
            value={formatPaise(onlineTaken)}
            hint="Gateway · settles separately"
          />
        </dl>
      </section>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <section className="rounded-xl border border-line bg-surface p-4">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-muted text-sm">Boarded at the gate</h2>
            <p className="text-muted text-xs">{boardingStats?.events ?? 0} scans · 24h</p>
          </div>
          <p className="mt-1 text-2xl font-bold tabular-nums">
            {boarded}
            {expected > 0 ? <span className="text-muted font-medium"> of {expected}</span> : null}
          </p>
          {expected > 0 ? (
            <Meter
              value={boarded}
              total={expected}
              label={`${boarded} of ${expected} expected visitors boarded`}
            />
          ) : (
            <p className="text-muted mt-2 text-xs">No confirmed bookings for today yet.</p>
          )}
        </section>

        <section className="rounded-xl border border-line bg-surface p-4">
          <h2 className="text-muted text-sm">Where bookings came from</h2>
          <p className="mt-1 text-2xl font-bold tabular-nums">
            {online} <span className="text-muted font-medium">online</span> · {counter}{" "}
            <span className="text-muted font-medium">counter</span>
          </p>
          {online + counter > 0 ? (
            <>
              <div
                className="mt-3 flex h-2 overflow-hidden rounded-full bg-background"
                role="img"
                aria-label={`${online} online and ${counter} counter bookings`}
              >
                <div className="bg-brand" style={{ width: `${(online / (online + counter)) * 100}%` }} />
                <div className="bg-accent" style={{ width: `${(counter / (online + counter)) * 100}%` }} />
              </div>
              <p className="text-muted mt-2 flex gap-4 text-xs">
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-brand" /> Online
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-accent" /> Counter
                </span>
              </p>
            </>
          ) : (
            <p className="text-muted mt-2 text-xs">Nothing booked for today yet.</p>
          )}
        </section>
      </div>

      <section className="mt-8">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="font-semibold">Gate scanners</h2>
          <Link href="/admin/devices" className="text-brand text-sm underline">
            Manage
          </Link>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {scanners.length === 0 ? (
            <p className="text-muted rounded-xl border border-line bg-surface p-4 text-sm sm:col-span-2">
              No scanner registered yet.{" "}
              <Link href="/admin/devices" className="text-brand underline">
                Register one
              </Link>
              .
            </p>
          ) : (
            scanners.map((d) => (
              <div
                key={d.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface p-4"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{d.name}</p>
                  <p className="text-muted text-sm">
                    {d.lastSyncAt ? `Last sync ${formatLocalTime(d.lastSyncAt)}` : "Never synced"}
                  </p>
                </div>
                <StatusPill active={d.active} stale={d.stale} />
              </div>
            ))
          )}
        </div>
      </section>
    </main>
  );
}

function Stat({
  label,
  value,
  hint,
  emphasis,
}: {
  label: string;
  value: string;
  hint?: string;
  emphasis?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-4 ${
        emphasis ? "border-brand/30 bg-brand/5" : "border-line bg-surface"
      }`}
    >
      <p className="text-muted text-sm">{label}</p>
      <p
        className={`mt-1 font-bold tabular-nums ${
          emphasis ? "text-3xl text-brand" : "text-2xl"
        }`}
      >
        {value}
      </p>
      {hint ? <p className="text-muted mt-1 text-xs">{hint}</p> : null}
    </div>
  );
}

/** Boarding progress. Capped at 100% so a re-scan can never overflow the bar. */
function Meter({ value, total, label }: { value: number; total: number; label: string }) {
  const pct = Math.min(100, Math.round((value / total) * 100));
  return (
    <div className="mt-3">
      <div
        className="h-2 overflow-hidden rounded-full bg-background"
        role="img"
        aria-label={label}
      >
        <div className="h-full rounded-full bg-ok transition-[width]" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-muted mt-2 text-xs">{pct}% of expected visitors</p>
    </div>
  );
}

function StatusPill({ active, stale }: { active: boolean; stale: boolean }) {
  const tone = !active
    ? "bg-danger/10 text-danger"
    : stale
      ? "bg-accent/10 text-accent"
      : "bg-ok/10 text-ok";
  return (
    <span
      className={`flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold ${tone}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {!active ? "Deactivated" : stale ? "Stale" : "Synced"}
    </span>
  );
}

function Taking({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-lg border border-line bg-background px-3 py-2.5">
      <dt className="text-muted text-xs uppercase tracking-wide">{label}</dt>
      <dd className="mt-0.5 text-xl font-bold tabular-nums">{value}</dd>
      <dd className="text-muted mt-0.5 text-[11px]">{hint}</dd>
    </div>
  );
}
