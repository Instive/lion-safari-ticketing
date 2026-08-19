import { and, eq, sql } from "drizzle-orm";
import Link from "next/link";

import { db } from "@/db";
import { bookings } from "@/db/schema";
import { BrandMark } from "@/components/staff/brand-mark";
import { requirePageStaff, roleAllows } from "@/lib/auth/guards";
import type { StaffRole } from "@/db/schema";
import { businessDate, formatVisitDate } from "@/lib/time";

export const metadata = { title: "Staff — Lion Safari" };
export const dynamic = "force-dynamic";

type Destination = {
  href: string;
  title: string;
  blurb: string;
  roles: StaffRole[];
  icon: "counter" | "search" | "scanner" | "admin";
};

/**
 * Every staff destination, with the role that may open it. Filtered through the
 * same `roleAllows` the pages themselves use, so this launcher can never offer a
 * tile that would bounce the person straight back to a denial.
 */
const DESTINATIONS: Destination[] = [
  {
    href: "/counter",
    title: "Cash booking",
    blurb: "Sell a ticket and take cash at the window.",
    roles: ["COUNTER"],
    icon: "counter",
  },
  {
    href: "/counter/lookup",
    title: "Find a ticket",
    blurb: "Look up and reprint a ticket a guest has lost.",
    roles: ["COUNTER"],
    icon: "search",
  },
  {
    href: "/scanner",
    title: "Gate scanner",
    blurb: "Scan boarding passes at the safari gate.",
    roles: ["SCANNER"],
    icon: "scanner",
  },
  {
    href: "/admin",
    title: "Admin dashboard",
    blurb: "Today's numbers, bookings, devices and staff.",
    roles: ["ADMIN"],
    icon: "admin",
  },
];

export default async function StaffHome() {
  const staff = await requirePageStaff(["COUNTER", "SCANNER", "ADMIN"]);
  const today = businessDate();

  const open = DESTINATIONS.filter((d) => roleAllows(staff.role, d.roles));

  // Counter staff get their own count; an admin sees the whole window's.
  const [salesToday] = await db
    .select({
      count: sql<number>`count(*)::int`,
      visitors: sql<number>`coalesce(sum(${bookings.visitorCount}), 0)::int`,
    })
    .from(bookings)
    .where(
      and(
        eq(bookings.channel, "COUNTER"),
        eq(bookings.visitDate, today),
        sql`${bookings.status} = 'CASH_CONFIRMED'`,
        staff.role === "ADMIN"
          ? sql`true`
          : eq(bookings.createdByStaffId, staff.id),
      ),
    );

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8">
      <div className="flex flex-col gap-6">
        <BrandMark size="lg" />

        <div>
          <h1 className="text-2xl font-semibold">
            Good to see you, {staff.name.split(" ")[0]}.
          </h1>
          <p className="text-muted mt-1 text-sm">
            {formatVisitDate(today)} · signed in as {staff.role.toLowerCase()}
          </p>
        </div>
      </div>

      {(salesToday?.count ?? 0) > 0 ? (
        <p className="mt-6 rounded-xl border border-line bg-surface px-4 py-3 text-sm">
          <span className="font-semibold">{salesToday!.count}</span> cash{" "}
          {salesToday!.count === 1 ? "sale" : "sales"} today
          {staff.role === "ADMIN" ? " across the counter" : ""} ·{" "}
          <span className="font-semibold">{salesToday!.visitors}</span>{" "}
          {salesToday!.visitors === 1 ? "visitor" : "visitors"}
        </p>
      ) : null}

      <nav className="mt-6 grid gap-3 sm:grid-cols-2">
        {open.map((d) => (
          <Link
            key={d.href}
            href={d.href}
            className="group flex items-start gap-4 rounded-xl border border-line bg-surface p-5 transition-colors hover:border-brand"
          >
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-brand/10 text-brand transition-colors group-hover:bg-brand group-hover:text-white">
              <Icon name={d.icon} />
            </span>
            <span>
              <span className="block font-semibold">{d.title}</span>
              <span className="text-muted mt-0.5 block text-sm">{d.blurb}</span>
            </span>
          </Link>
        ))}
      </nav>
    </main>
  );
}

function Icon({ name }: { name: Destination["icon"] }) {
  const common = {
    width: 20,
    height: 20,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  switch (name) {
    case "counter":
      return (
        <svg {...common}>
          <rect x="2" y="6" width="20" height="12" rx="2" />
          <circle cx="12" cy="12" r="2.5" />
          <path d="M6 12h.01M18 12h.01" />
        </svg>
      );
    case "search":
      return (
        <svg {...common}>
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
      );
    case "scanner":
      return (
        <svg {...common}>
          <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" />
          <path d="M4 12h16" />
        </svg>
      );
    case "admin":
      return (
        <svg {...common}>
          <path d="M3 20h18" />
          <path d="M6 20V10M11 20V4M16 20v-7M21 20v-4" />
        </svg>
      );
  }
}
