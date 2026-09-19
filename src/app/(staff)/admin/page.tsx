import { and, eq, sql } from "drizzle-orm";
import Link from "next/link";

import { db } from "@/db";
import { boardingEvents, bookings, devices, tickets } from "@/db/schema";
import { requirePageStaff } from "@/lib/auth/guards";
import { formatPaise } from "@/lib/money";
import { businessDate, formatLocalTime, formatVisitDate } from "@/lib/time";

export const metadata = { title: "Admin — Lion Safari" };
export const dynamic = "force-dynamic";

const SECTIONS = [
  { href: "/admin/bookings", label: "Bookings" },
  { href: "/admin/rates", label: "Rates" },
  { href: "/admin/books", label: "Ticket books" },
  { href: "/admin/enquiries", label: "Group enquiries" },
  { href: "/admin/reconciliation", label: "Reconciliation" },
  { href: "/admin/devices", label: "Devices" },
  { href: "/admin/staff", label: "Staff" },
];

export default async function AdminDashboard() {
  await requirePageStaff(["ADMIN"]);
  const today = businessDate();
  // Computed by the database so every screen agrees on "now". This is a
  // ROLLING 24-hour window, not the start of the park day — it backs the
  // "awaiting payment" figure, which is deliberately a recency question
  // ("anything stuck lately?") rather than a per-day one.
  const last24h = sql`now() - interval '24 hours'`;

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

  // Counted against the day the guest was booked FOR, not a rolling clock
  // window, because this is compared directly against `expected` below — which
  // is today's visit date. Filtering on `boardedAt >= now() - 24h` mixed
  // populations: yesterday evening's scans measured against only today's
  // bookings, which is what produced a "boarded" figure larger than "expected".
  //
  // `tickets.visitDate` is denormalized from the booking (see schema), so one
  // join is enough, and a guest booked for today still counts as today however
  // late in the evening they actually scanned.
  const [boardingStats] = await db
    .select({
      events: sql<number>`count(*)::int`,
      boarded: sql<number>`coalesce(sum(${boardingEvents.boardedCount}), 0)::int`,
    })
    .from(boardingEvents)
    .innerJoin(tickets, eq(tickets.id, boardingEvents.ticketId))
    .where(eq(tickets.visitDate, today));

  const [pendingStats] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(bookings)
    .where(and(eq(bookings.status, "PENDING"), sql`${bookings.createdAt} >= ${last24h}`));

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
            <p className="text-muted text-xs">{boardingStats?.events ?? 0} scans · today</p>
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

/**
 * Boarding progress.
 *
 * The BAR is capped at 100% because a bar cannot be more than full. The
 * NUMBER is not: now that both figures count the same day, more people
 * boarding than were sold tickets for is a real problem worth seeing —
 * double-scanning, or a manifest that disagrees with the gate — and rounding
 * it down to a reassuring "100%" is how it would go unnoticed.
 */
function Meter({ value, total, label }: { value: number; total: number; label: string }) {
  const pct = Math.round((value / total) * 100);
  const over = pct > 100;
  return (
    <div className="mt-3">
      <div
        className="h-2 overflow-hidden rounded-full bg-background"
        role="img"
        aria-label={label}
      >
        <div
          className={`h-full rounded-full transition-[width] ${over ? "bg-danger" : "bg-ok"}`}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
      <p className={`mt-2 text-xs ${over ? "font-medium text-danger" : "text-muted"}`}>
        {pct}% of expected visitors
        {over ? " — more scans than tickets sold, worth checking" : null}
      </p>
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
