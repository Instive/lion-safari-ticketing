import { eq } from "drizzle-orm";

import type { Tx } from "@/db";
import { tickets, type Booking, type Ticket } from "@/db/schema";
import { generateTicketToken } from "@/lib/codes";
import { writeAudit, writeChange, type Actor } from "../audit";
import { isConfirmed } from "../booking/status";
import { DomainError } from "../errors";

/**
 * Issues the ticket for a confirmed booking.
 *
 * Idempotent by construction: `tickets.booking_id` is UNIQUE, so a retry — a
 * replayed webhook, a double-clicked counter button, a re-run delivery job —
 * returns the ticket that already exists instead of minting a second valid QR
 * (spec §13).
 */
export async function issueTicketFor(
  tx: Tx,
  booking: Booking,
  actor: Actor,
): Promise<{ ticket: Ticket; created: boolean }> {
  if (!isConfirmed(booking.status)) {
    // The one rule that protects the gate: no confirmation, no ticket.
    throw new DomainError(
      "BOOKING_NOT_CONFIRMED",
      "This booking is not confirmed yet.",
      `status=${booking.status}`,
    );
  }

  const [inserted] = await tx
    .insert(tickets)
    .values({
      bookingId: booking.id,
      token: generateTicketToken(),
      visitorCount: booking.visitorCount,
      visitDate: booking.visitDate,
      status: "ACTIVE",
    })
    .onConflictDoNothing({ target: tickets.bookingId })
    .returning();

  if (!inserted) {
    const [existing] = await tx
      .select()
      .from(tickets)
      .where(eq(tickets.bookingId, booking.id))
      .limit(1);
    return { ticket: existing!, created: false };
  }

  await writeAudit(tx, {
    actor,
    action: "ticket.issued",
    entity: "ticket",
    entityId: inserted.id,
    after: { bookingId: booking.id, visitorCount: inserted.visitorCount },
  });

  await writeChange(tx, {
    entity: "ticket",
    entityId: inserted.id,
    operation: "INSERT",
    payload: { status: inserted.status },
  });

  return { ticket: inserted, created: true };
}

/**
 * Invalidates a ticket when its booking is cancelled or refunded. Pushed onto
 * the sync feed so the gate scanner stops accepting it.
 */
export async function deactivateTicketForBooking(
  tx: Tx,
  bookingId: string,
  status: "CANCELLED" | "EXPIRED",
  actor: Actor,
): Promise<Ticket | null> {
  const [ticket] = await tx
    .select()
    .from(tickets)
    .where(eq(tickets.bookingId, bookingId))
    .for("update")
    .limit(1);

  if (!ticket) return null;
  // A ticket already used at the gate stays USED — history is not rewritten.
  if (ticket.status !== "ACTIVE") return ticket;

  const [updated] = await tx
    .update(tickets)
    .set({ status, updatedAt: new Date() })
    .where(eq(tickets.id, ticket.id))
    .returning();

  await writeAudit(tx, {
    actor,
    action: `ticket.${status.toLowerCase()}`,
    entity: "ticket",
    entityId: ticket.id,
    before: { status: ticket.status },
    after: { status },
  });

  await writeChange(tx, {
    entity: "ticket",
    entityId: ticket.id,
    operation: "UPDATE",
    payload: { status },
  });

  return updated!;
}
