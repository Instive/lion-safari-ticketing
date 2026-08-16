import { desc, eq, like, or, sql } from "drizzle-orm";
import Link from "next/link";

import { db } from "@/db";
import { bookings, tickets } from "@/db/schema";
import { requirePageStaff } from "@/lib/auth/guards";
import { formatPaise } from "@/lib/money";
import { formatLocalTime } from "@/lib/time";
import { StatusPill } from "../status-pill";

export const metadata = { title: "Bookings — Lion Safari" };
export const dynamic = "force-dynamic";

export default async function AdminBookingsPage({
  searchParams,
}: PageProps<"/admin/bookings">) {
  await requirePageStaff(["ADMIN"]);
  const { q } = await searchParams;
  const query = typeof q === "string" ? q.trim() : "";

  const rows = await db
    .select({
      id: bookings.id,
      bookingCode: bookings.bookingCode,
      channel: bookings.channel,
      status: bookings.status,
      visitorCount: bookings.visitorCount,
      amountTotal: bookings.amountTotal,
      visitDate: bookings.visitDate,
      customerName: bookings.customerName,
      customerPhone: bookings.customerPhone,
      createdAt: bookings.createdAt,
      ticketStatus: tickets.status,
    })
    .from(bookings)
    .leftJoin(tickets, eq(tickets.bookingId, bookings.id))
    .where(
      query
        ? or(
            eq(bookings.bookingCode, query.toUpperCase()),
            like(bookings.customerPhone, `%${query}%`),
            sql`lower(${bookings.customerName}) like ${`%${query.toLowerCase()}%`}`,
            sql`lower(${bookings.customerEmail}) like ${`%${query.toLowerCase()}%`}`,
          )
        : undefined,
    )
    .orderBy(desc(bookings.createdAt))
    .limit(100);

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6">
      <div className="mb-4 flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">Bookings</h1>
        <Link href="/admin" className="text-sm text-brand underline">
          ← Dashboard
        </Link>
      </div>

      <form className="mb-5 flex gap-2">
        <input
          name="q"
          defaultValue={query}
          placeholder="Booking code, phone, name or email"
          className="touch-target flex-1 rounded-lg border border-line px-3 text-base outline-none focus:border-brand"
        />
        <button
          type="submit"
          className="touch-target rounded-lg bg-brand px-5 font-semibold text-white hover:bg-brand-strong"
        >
          Search
        </button>
      </form>

      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full min-w-[42rem] text-sm">
          <thead className="border-b border-line text-left">
            <tr className="text-muted">
              <th className="px-4 py-3 font-medium">Booking</th>
              <th className="px-4 py-3 font-medium">Guest</th>
              <th className="px-4 py-3 font-medium">Visitors</th>
              <th className="px-4 py-3 font-medium">Amount</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Created</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-muted px-4 py-8 text-center">
                  {query ? `No bookings match “${query}”.` : "No bookings yet."}
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/bookings/${r.bookingCode}`}
                      className="font-mono font-semibold tracking-wider text-brand underline"
                    >
                      {r.bookingCode}
                    </Link>
                    <p className="text-muted text-xs">{r.channel.toLowerCase()}</p>
                  </td>
                  <td className="px-4 py-3">
                    {r.customerName ?? <span className="text-muted">—</span>}
                    {r.customerPhone ? (
                      <p className="text-muted text-xs">{r.customerPhone}</p>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 tabular-nums">{r.visitorCount}</td>
                  <td className="px-4 py-3 tabular-nums">{formatPaise(r.amountTotal)}</td>
                  <td className="px-4 py-3">
                    <StatusPill status={r.status} ticketStatus={r.ticketStatus} />
                  </td>
                  <td className="text-muted px-4 py-3">{formatLocalTime(r.createdAt)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
