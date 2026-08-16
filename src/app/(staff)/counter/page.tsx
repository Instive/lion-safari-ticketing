import { randomUUID } from "node:crypto";
import Link from "next/link";

import { requirePageStaff } from "@/lib/auth/guards";
import { MAX_VISITORS_PER_BOOKING } from "@/domain/booking/pricing";
import { env } from "@/lib/env";
import { formatVisitDate } from "@/lib/time";
import { businessDate } from "@/lib/time";
import { CounterForm } from "./counter-form";

export const metadata = { title: "Counter — Lion Safari" };

export default async function CounterPage() {
  await requirePageStaff(["COUNTER"]);
  const today = businessDate();

  return (
    <main className="mx-auto w-full max-w-md px-4 py-6">
      <div className="mb-5 flex items-baseline justify-between">
        <div>
          <h1 className="text-xl font-semibold">Cash booking</h1>
          <p className="text-muted text-sm">{formatVisitDate(today)}</p>
        </div>
        <Link href="/counter/lookup" className="text-sm text-brand underline">
          Find a ticket
        </Link>
      </div>

      <CounterForm
        perVisitorPaise={env.TICKET_PRICE_PAISE}
        maxVisitors={MAX_VISITORS_PER_BOOKING}
        idempotencyKey={randomUUID()}
      />
    </main>
  );
}
