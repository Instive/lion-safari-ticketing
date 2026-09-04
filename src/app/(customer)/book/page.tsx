import { randomUUID } from "node:crypto";
import Link from "next/link";

import { MAX_VISITORS_PER_BOOKING } from "@/domain/booking/pricing";
import {
  MAX_ADVANCE_DAYS,
  bookableRange,
  isClosedDay,
  nextOpenDay,
} from "@/domain/booking/visit-date";
import { env } from "@/lib/env";
import { BookingForm } from "./booking-form";

export const metadata = { title: "Book your safari — Chhatbir Zoo" };
export const dynamic = "force-dynamic";

export default function BookPage() {
  const { min, max } = bookableRange();
  // Today is the natural default, but on a Monday the park is shut and the
  // server would reject it — so open on the next day that is actually bookable.
  const defaultVisitDate = isClosedDay(min) ? nextOpenDay(min) : min;

  return (
    <main className="mx-auto w-full max-w-md px-4 py-8">
      <div className="mb-6">
        <Link href="/" className="text-muted text-sm hover:text-foreground">
          ← Back
        </Link>
        <h1 className="mt-2 font-display text-4xl tracking-wide text-brand">Book Your Safari</h1>
      </div>

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
