import Link from "next/link";

import { env } from "@/lib/env";
import { formatPaise } from "@/lib/money";
import { businessDate, formatVisitDate } from "@/lib/time";

export const dynamic = "force-dynamic";

export default function HomePage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-10">
      <header className="mb-8 text-center">
        <p className="text-accent text-sm font-medium uppercase tracking-wide">Welcome to</p>
        <h1 className="text-brand mt-1 text-3xl font-bold">Lion Safari</h1>
        <p className="text-muted mt-3">
          Book your entry online and show the QR code at the boarding gate.
        </p>
      </header>

      <div className="rounded-xl border border-line bg-surface p-6 text-center">
        <p className="text-muted text-sm">Entry today, {formatVisitDate(businessDate())}</p>
        <p className="mt-1 text-3xl font-bold">{formatPaise(env.TICKET_PRICE_PAISE)}</p>
        <p className="text-muted text-sm">per visitor</p>

        <Link
          href="/book"
          className="touch-target mt-6 grid w-full place-items-center rounded-xl bg-brand font-semibold text-white hover:bg-brand-strong"
        >
          Book now
        </Link>
      </div>

      <div className="mt-6 rounded-xl border border-line bg-surface p-5">
        <h2 className="font-medium">Already booked?</h2>
        <p className="text-muted mt-1 text-sm">
          Find your ticket again using your booking code and mobile number.
        </p>
        <Link href="/ticket" className="mt-3 inline-block text-sm font-medium text-brand underline">
          Find my ticket
        </Link>
      </div>

      <p className="text-muted mt-8 text-center text-xs">
        Tickets are also available for cash at the counter.
        {env.SUPPORT_PHONE ? ` Need help? Call ${env.SUPPORT_PHONE}` : ""}
      </p>
    </main>
  );
}
