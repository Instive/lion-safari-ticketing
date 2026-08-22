import { desc, eq, sql } from "drizzle-orm";
import Link from "next/link";

import { db } from "@/db";
import { bookings, rateCategories } from "@/db/schema";
import { requirePageStaff } from "@/lib/auth/guards";
import { env } from "@/lib/env";
import { formatPaise } from "@/lib/money";
import { RateManager } from "./rate-manager";

export const metadata = { title: "Rates — Lion Safari" };
export const dynamic = "force-dynamic";

export default async function AdminRatesPage() {
  await requirePageStaff(["ADMIN"]);

  const rates = await db
    .select({
      id: rateCategories.id,
      name: rateCategories.name,
      perVisitorPaise: rateCategories.perVisitorPaise,
      active: rateCategories.active,
      // Shown next to each rate so retiring one is an informed decision.
      soldCount: sql<number>`(
        select count(*) from ${bookings}
        where ${bookings.rateCategoryId} = ${rateCategories.id}
      )::int`,
    })
    .from(rateCategories)
    .orderBy(eq(rateCategories.active, false), desc(rateCategories.createdAt));

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6">
      <Link href="/admin" className="text-muted text-sm hover:text-foreground">
        ← Dashboard
      </Link>
      <h1 className="mt-1 text-2xl font-semibold">Ticket rates</h1>
      <p className="text-muted mb-5 text-sm">
        Concession prices for schools, groups and invited guests. The standard fare is{" "}
        {formatPaise(env.TICKET_PRICE_PAISE)} per visitor and is set in the environment, not here.
        Changing a rate affects future sales only — every booking keeps the price it was sold at.
      </p>

      <RateManager rates={rates} standardPaise={env.TICKET_PRICE_PAISE} />
    </main>
  );
}
