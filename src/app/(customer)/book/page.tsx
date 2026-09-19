import { randomUUID } from "node:crypto";
import Link from "next/link";

import { MAX_VISITORS_PER_BOOKING } from "@/domain/booking/pricing";
import {
  MAX_ADVANCE_DAYS,
  bookableRange,
  isClosedDay,
  isTodayStillBookable,
  nextOpenDay,
} from "@/domain/booking/visit-date";
import { env } from "@/lib/env";
import { BookingForm } from "./booking-form";

export const metadata = { title: "Book your safari — Chhatbir Zoo" };
export const dynamic = "force-dynamic";

export default function BookPage() {
  // `min` is already tomorrow if the park has closed for today, so the picker
  // never offers a date checkout would refuse. A Monday still has to be skipped
  // past on top of that.
  const { min, max } = bookableRange();
  const defaultVisitDate = isClosedDay(min) ? nextOpenDay(min) : min;
  const closedForToday = !isTodayStillBookable();

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8">
      <div className="mb-6">
        <Link href="/" className="text-muted text-sm hover:text-foreground">
          ← Back
        </Link>
        <h1 className="mt-2 font-display text-4xl tracking-wide text-brand">Book Your Safari</h1>
        <p className="mt-2 text-muted">One ticket, both habitats. Choose your visit and book in a few simple steps.</p>
      </div>

      {/*
        A two-way choice rather than a link buried under the form: someone
        booking for a school needs to know BEFORE filling in a standard-fare
        form that their price is different, otherwise they either pay the wrong
        amount or abandon halfway. Rendered as tabs because these are two
        genuine routes to a visit, not a primary action and a footnote.
      */}
      <div
        role="navigation"
        aria-label="How are you booking?"
        className="mb-3 grid max-w-md grid-cols-2 gap-1 rounded-xl border border-line bg-surface p-1"
      >
        <span
          aria-current="page"
          className="flex items-center justify-center rounded-lg bg-brand px-3 py-2.5 text-center text-sm font-semibold text-white"
        >
          Standard booking
        </span>
        <Link
          href="/groups"
          className="flex items-center justify-center rounded-lg px-3 py-2.5 text-center text-sm font-semibold transition-colors hover:bg-background hover:text-brand"
        >
          Schools &amp; large groups
        </Link>
      </div>

      <p className="mb-6 text-sm text-muted">
        Standard booking is for solo visitors, families and friends. Schools, institutions and
        larger groups can request a quote under Schools &amp; large groups.
      </p>

      {closedForToday ? (
        <p className="mb-4 rounded-xl border border-line bg-surface p-4 text-sm">
          Today&rsquo;s safari has closed. You can book for tomorrow onwards.
        </p>
      ) : null}

      <BookingForm
        perVisitorPaise={env.TICKET_PRICE_PAISE}
        convenienceFeePaise={env.CONVENIENCE_FEE_PAISE}
        maxVisitors={MAX_VISITORS_PER_BOOKING}
        minVisitDate={min}
        maxVisitDate={max}
        defaultVisitDate={defaultVisitDate}
        maxAdvanceDays={MAX_ADVANCE_DAYS}
        idempotencyKey={randomUUID()}
      />
    </main>
  );
}
