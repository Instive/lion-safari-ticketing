"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { createCounterBooking } from "@/domain/booking/create";
import { MAX_VISITORS_PER_BOOKING } from "@/domain/booking/pricing";
import { DomainError } from "@/domain/errors";
import { requireStaff } from "@/lib/auth/guards";

const schema = z.object({
  visitorCount: z.coerce.number().int().min(1).max(MAX_VISITORS_PER_BOOKING),
  /** Minted in the browser when the sale screen loaded; makes a double-tap safe. */
  idempotencyKey: z.uuid(),
  customerName: z.string().trim().max(120).optional(),
  customerPhone: z
    .string()
    .trim()
    .regex(/^[0-9+\-\s]{6,20}$/, "invalid phone")
    .optional()
    .or(z.literal("")),
});

export type CashSaleState = { error?: string };

/**
 * Counter cash sale. The booking is created already CASH_CONFIRMED and its
 * ticket is issued in the same transaction — the staff member is holding the
 * money, so there is no in-between state to recover from.
 */
export async function createCashSaleAction(
  _prev: CashSaleState,
  formData: FormData,
): Promise<CashSaleState> {
  const staff = await requireStaff(["COUNTER"]);

  const parsed = schema.safeParse({
    visitorCount: formData.get("visitorCount"),
    idempotencyKey: formData.get("idempotencyKey"),
    customerName: formData.get("customerName") ?? undefined,
    customerPhone: formData.get("customerPhone") ?? undefined,
  });

  if (!parsed.success) {
    return { error: "Please check the visitor count and try again." };
  }

  let bookingCode: string;
  try {
    const result = await createCounterBooking({
      visitorCount: parsed.data.visitorCount,
      customerName: parsed.data.customerName || null,
      customerPhone: parsed.data.customerPhone || null,
      idempotencyKey: parsed.data.idempotencyKey,
      createdByStaffId: staff.id,
      actor: { type: "STAFF", id: staff.id, name: staff.name },
    });
    bookingCode = result.booking.bookingCode;
  } catch (err) {
    if (err instanceof DomainError) return { error: err.userMessage };
    // Technical detail is logged, never shown (spec §17).
    console.error("[counter] cash sale failed", err);
    return { error: "Could not complete the sale. Please try again." };
  }

  redirect(`/counter/ticket/${bookingCode}`);
}
