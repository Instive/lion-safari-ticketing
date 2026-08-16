"use server";

import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { db } from "@/db";
import { bookings } from "@/db/schema";
import { clientIpFrom } from "@/lib/auth/session";
import { limitTicketRecovery } from "@/lib/rate-limit";

const schema = z.object({
  bookingCode: z.string().trim().min(4).max(20),
  phone: z.string().trim().regex(/^[0-9]{10}$/),
});

export type RecoverState = { error?: string };

/**
 * Ticket recovery (spec §17). Requires the booking code AND the phone number on
 * the booking, so knowing a code alone is not enough to pull up someone's QR.
 */
export async function recoverTicketAction(
  _prev: RecoverState,
  formData: FormData,
): Promise<RecoverState> {
  const ip = clientIpFrom(await headers()) ?? "unknown";
  const limit = await limitTicketRecovery(ip);
  if (!limit.allowed) {
    return { error: "Too many attempts. Please try again in a minute." };
  }

  const parsed = schema.safeParse({
    bookingCode: formData.get("bookingCode"),
    phone: formData.get("phone"),
  });

  if (!parsed.success) {
    return { error: "Enter your booking code and the 10-digit mobile number you booked with." };
  }

  const [match] = await db
    .select({ bookingCode: bookings.bookingCode })
    .from(bookings)
    .where(
      and(
        eq(bookings.bookingCode, parsed.data.bookingCode.toUpperCase()),
        eq(bookings.customerPhone, parsed.data.phone),
      ),
    )
    .limit(1);

  if (!match) {
    // One message for both wrong-code and wrong-phone: no confirmation that a
    // given booking code exists.
    return { error: "We could not find a booking with those details." };
  }

  redirect(`/ticket/${match.bookingCode}`);
}
