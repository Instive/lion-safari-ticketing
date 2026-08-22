"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/db";
import { rateCategories } from "@/db/schema";
import { writeAudit } from "@/domain/audit";
import { requireStaff } from "@/lib/auth/guards";
import { env } from "@/lib/env";
import { formatPaise, rupeeStringToPaise } from "@/lib/money";

export type RateState = { error?: string; success?: string };

const nameSchema = z.string().trim().min(2).max(60);
/** Rupees as typed; concessions are whole-rupee amounts in practice. */
const priceSchema = z.coerce.number().min(0).max(1_000_000);

/**
 * Guard shared by create and re-price: a concession that costs MORE than the
 * standard fare is either a typo or a way to overcharge, and neither should
 * reach the counter's buttons.
 */
function checkPrice(paise: number): string | null {
  if (!Number.isInteger(paise) || paise < 0) return "Enter a price of zero or more.";
  if (paise > env.TICKET_PRICE_PAISE) {
    return `A rate cannot be more than the standard ${formatPaise(env.TICKET_PRICE_PAISE)} fare.`;
  }
  return null;
}

export async function createRateAction(
  _prev: RateState,
  formData: FormData,
): Promise<RateState> {
  const staff = await requireStaff(["ADMIN"]);

  const parsed = z
    .object({ name: nameSchema, priceRupees: priceSchema })
    .safeParse({
      name: formData.get("name"),
      priceRupees: formData.get("priceRupees"),
    });

  if (!parsed.success) {
    return { error: "Give the rate a name of at least two characters and a price." };
  }

  const perVisitorPaise = rupeeStringToPaise(parsed.data.priceRupees);
  const priceError = checkPrice(perVisitorPaise);
  if (priceError) return { error: priceError };

  try {
    const [created] = await db
      .insert(rateCategories)
      .values({
        name: parsed.data.name,
        perVisitorPaise,
        createdByStaffId: staff.id,
      })
      .returning();

    await writeAudit(db, {
      actor: { type: "STAFF", id: staff.id, name: staff.name },
      action: "rate.created",
      entity: "rate_category",
      entityId: created!.id,
      after: { name: created!.name, perVisitorPaise: created!.perVisitorPaise },
    });

    revalidatePath("/admin/rates");
    return { success: `“${created!.name}” added at ${formatPaise(perVisitorPaise)} per visitor.` };
  } catch (err) {
    if (err instanceof Error && err.message.includes("rate_categories_name_unique")) {
      return { error: "A rate with that name already exists." };
    }
    console.error("[admin] create rate failed", err);
    return { error: "Could not add that rate." };
  }
}

/**
 * Re-prices a rate from today on. Past bookings keep what they were sold at:
 * `bookings.per_visitor_paise` is a recorded fact, not a lookup, so nothing
 * here can rewrite yesterday's takings.
 */
export async function updateRateAction(
  _prev: RateState,
  formData: FormData,
): Promise<RateState> {
  const staff = await requireStaff(["ADMIN"]);

  const parsed = z
    .object({ id: z.uuid(), priceRupees: priceSchema })
    .safeParse({ id: formData.get("id"), priceRupees: formData.get("priceRupees") });

  if (!parsed.success) return { error: "That price could not be read." };

  const perVisitorPaise = rupeeStringToPaise(parsed.data.priceRupees);
  const priceError = checkPrice(perVisitorPaise);
  if (priceError) return { error: priceError };

  const [before] = await db
    .select()
    .from(rateCategories)
    .where(eq(rateCategories.id, parsed.data.id))
    .limit(1);
  if (!before) return { error: "That rate no longer exists." };

  await db
    .update(rateCategories)
    .set({ perVisitorPaise, updatedAt: new Date() })
    .where(eq(rateCategories.id, parsed.data.id));

  await writeAudit(db, {
    actor: { type: "STAFF", id: staff.id, name: staff.name },
    action: "rate.repriced",
    entity: "rate_category",
    entityId: before.id,
    before: { perVisitorPaise: before.perVisitorPaise },
    after: { perVisitorPaise },
  });

  revalidatePath("/admin/rates");
  revalidatePath("/counter");
  return { success: `“${before.name}” is now ${formatPaise(perVisitorPaise)} per visitor.` };
}

/** Rates are retired, never deleted — bookings sold under them still point here. */
export async function setRateActiveAction(
  _prev: RateState,
  formData: FormData,
): Promise<RateState> {
  const staff = await requireStaff(["ADMIN"]);

  const parsed = z
    .object({ id: z.uuid(), active: z.enum(["true", "false"]) })
    .safeParse({ id: formData.get("id"), active: formData.get("active") });
  if (!parsed.success) return { error: "That rate could not be updated." };

  const active = parsed.data.active === "true";
  const [updated] = await db
    .update(rateCategories)
    .set({ active, updatedAt: new Date() })
    .where(eq(rateCategories.id, parsed.data.id))
    .returning();

  if (!updated) return { error: "That rate no longer exists." };

  await writeAudit(db, {
    actor: { type: "STAFF", id: staff.id, name: staff.name },
    action: active ? "rate.activated" : "rate.retired",
    entity: "rate_category",
    entityId: updated.id,
    after: { name: updated.name, active },
  });

  revalidatePath("/admin/rates");
  revalidatePath("/counter");
  return {
    success: active
      ? `“${updated.name}” is back on the counter.`
      : `“${updated.name}” is no longer offered at the counter.`,
  };
}
