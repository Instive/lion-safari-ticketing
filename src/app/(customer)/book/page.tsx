import { randomUUID } from "node:crypto";
import Link from "next/link";

import { MAX_VISITORS_PER_BOOKING } from "@/domain/booking/pricing";
import { env } from "@/lib/env";
import { businessDate, formatVisitDate } from "@/lib/time";
import { BookingForm } from "./booking-form";

export const metadata = { title: "Book your safari — Chhatbir Zoo" };
export const dynamic = "force-dynamic";

export default function BookPage() {
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
        visitDateLabel={formatVisitDate(businessDate())}
        idempotencyKey={randomUUID()}
      />
    </main>
  );
}
