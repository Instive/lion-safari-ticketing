import { eq } from "drizzle-orm";

import { db, type DbOrTx, type Tx } from "@/db";
import {
  boardingEvents,
  bookings,
  tickets,
  type BoardingEvent,
  type Ticket,
} from "@/db/schema";
import { businessDate } from "@/lib/time";
import { writeAudit, writeChange, type Actor } from "../audit";

/**
 * Every reason a QR can be turned away at the gate. Each carries wording that
 * is safe to show on the scanner — staff should never see a technical error
 * (spec §17).
 */
export type RejectionReason =
  | "NOT_FOUND"
  | "ALREADY_USED"
  | "CANCELLED"
  | "EXPIRED"
  | "WRONG_DATE"
  | "COUNT_MISMATCH";

export type TicketView = {
  ticketId: string;
  token: string;
  status: Ticket["status"];
  visitorCount: number;
  visitDate: string;
  bookingCode: string;
  usedAt: Date | null;
};

export type ValidationResult =
  | { valid: true; ticket: TicketView }
  | { valid: false; reason: RejectionReason; message: string; ticket: TicketView | null };

export function rejectionMessage(reason: RejectionReason, ticket?: TicketView | null): string {
  switch (reason) {
    case "NOT_FOUND":
      return "Ticket not recognised. Please send the guest to the counter.";
    case "ALREADY_USED":
      return "This ticket has already been used for boarding.";
    case "CANCELLED":
      return "This ticket was cancelled and cannot be used.";
    case "EXPIRED":
      return "This ticket has expired.";
    case "WRONG_DATE":
      return ticket
        ? `This ticket is for ${ticket.visitDate}, not today.`
        : "This ticket is not valid for today.";
    case "COUNT_MISMATCH":
      return "The number boarding must match the number on the ticket.";
  }
}

/**
 * Authoritative ticket check. The scanner runs the same rules against its local
 * cache for speed, but this server-side result always wins.
 */
export async function validateToken(
  token: string,
  today: string = businessDate(),
  conn: DbOrTx = db,
): Promise<ValidationResult> {
  const [row] = await conn
    .select({
      ticketId: tickets.id,
      token: tickets.token,
      status: tickets.status,
      visitorCount: tickets.visitorCount,
      visitDate: tickets.visitDate,
      usedAt: tickets.usedAt,
      bookingCode: bookings.bookingCode,
    })
    .from(tickets)
    .innerJoin(bookings, eq(bookings.id, tickets.bookingId))
    .where(eq(tickets.token, token))
    .limit(1);

  if (!row) {
    return { valid: false, reason: "NOT_FOUND", message: rejectionMessage("NOT_FOUND"), ticket: null };
  }

  const ticket: TicketView = row;

  if (ticket.status === "USED") {
    return { valid: false, reason: "ALREADY_USED", message: rejectionMessage("ALREADY_USED"), ticket };
  }
  if (ticket.status === "CANCELLED") {
    return { valid: false, reason: "CANCELLED", message: rejectionMessage("CANCELLED"), ticket };
  }
  if (ticket.status === "EXPIRED") {
    return { valid: false, reason: "EXPIRED", message: rejectionMessage("EXPIRED"), ticket };
  }
  if (ticket.visitDate !== today) {
    return { valid: false, reason: "WRONG_DATE", message: rejectionMessage("WRONG_DATE", ticket), ticket };
  }

  return { valid: true, ticket };
}

export type ConfirmBoardingInput = {
  /**
   * Identify the ticket either by the scanned token or by its id.
   *
   * The gate scanner uses `ticketId`: its offline cache stores only token
   * HASHES, never the tokens themselves, so a stolen device yields no usable
   * boarding credentials (spec §7.2).
   */
  token?: string;
  ticketId?: string;
  boardedCount: number;
  /** UUID minted on the scanner before queueing. The idempotency key for boarding. */
  clientEventId: string;
  staffId?: string | null;
  deviceId?: string | null;
  createdOffline?: boolean;
  /** Device-reported scan time; recorded for audit but never used for validity. */
  deviceReportedAt?: Date | null;
  actor: Actor;
};

export type ConfirmBoardingResult =
  | { ok: true; event: BoardingEvent; ticket: TicketView; duplicate: boolean }
  | { ok: false; reason: RejectionReason; message: string; ticket: TicketView | null };

/**
 * Records a boarding and consumes the ticket.
 *
 * Two independent guards make this safe:
 *  1. `client_event_id` is UNIQUE — replaying a queued offline event after a
 *     reconnect or app restart returns the original result, it never re-boards.
 *  2. The ticket row is locked FOR UPDATE and re-checked as ACTIVE — two
 *     genuinely different scans of the same QR cannot both succeed.
 */
export async function confirmBoarding(
  input: ConfirmBoardingInput,
): Promise<ConfirmBoardingResult> {
  const today = businessDate();

  return db.transaction(async (tx) => {
    // 1. Replay of an event we already recorded?
    const [replay] = await tx
      .select()
      .from(boardingEvents)
      .where(eq(boardingEvents.clientEventId, input.clientEventId))
      .limit(1);

    if (replay) {
      const view = await ticketViewById(tx, replay.ticketId);
      return { ok: true, event: replay, ticket: view!, duplicate: true };
    }

    // 2. Lock the ticket so a concurrent scan cannot slip past the status check.
    const where = input.ticketId
      ? eq(tickets.id, input.ticketId)
      : eq(tickets.token, input.token!);

    const [locked] = await tx.select().from(tickets).where(where).for("update").limit(1);

    if (!locked) {
      return {
        ok: false,
        reason: "NOT_FOUND",
        message: rejectionMessage("NOT_FOUND"),
        ticket: null,
      };
    }

    const view = (await ticketViewById(tx, locked.id))!;
    // Re-validated server-side even though the scanner already checked locally:
    // the local cache may be stale, and the server is authoritative.
    const check = await validateToken(locked.token, today, tx);
    if (!check.valid) return { ok: false, reason: check.reason, message: check.message, ticket: view };

    // 3. All-or-nothing boarding: the whole group boards together or not at all.
    if (input.boardedCount !== locked.visitorCount) {
      return {
        ok: false,
        reason: "COUNT_MISMATCH",
        message: rejectionMessage("COUNT_MISMATCH"),
        ticket: view,
      };
    }

    const now = new Date();

    const [event] = await tx
      .insert(boardingEvents)
      .values({
        ticketId: locked.id,
        boardedCount: input.boardedCount,
        staffId: input.staffId ?? null,
        deviceId: input.deviceId ?? null,
        clientEventId: input.clientEventId,
        boardedAt: now,
        deviceReportedAt: input.deviceReportedAt ?? null,
        createdOffline: input.createdOffline ?? false,
      })
      .returning();

    await tx
      .update(tickets)
      .set({ status: "USED", usedAt: now, updatedAt: now })
      .where(eq(tickets.id, locked.id));

    await writeAudit(tx, {
      actor: input.actor,
      action: "ticket.boarded",
      entity: "ticket",
      entityId: locked.id,
      before: { status: "ACTIVE" },
      after: { status: "USED", boardedCount: input.boardedCount },
      context: {
        clientEventId: input.clientEventId,
        deviceId: input.deviceId,
        createdOffline: input.createdOffline ?? false,
      },
    });

    await writeChange(tx, {
      entity: "ticket",
      entityId: locked.id,
      operation: "UPDATE",
      payload: { status: "USED" },
    });

    return {
      ok: true,
      event: event!,
      ticket: { ...view, status: "USED", usedAt: now },
      duplicate: false,
    };
  });
}

async function ticketViewById(tx: Tx, ticketId: string): Promise<TicketView | null> {
  const [row] = await tx
    .select({
      ticketId: tickets.id,
      token: tickets.token,
      status: tickets.status,
      visitorCount: tickets.visitorCount,
      visitDate: tickets.visitDate,
      usedAt: tickets.usedAt,
      bookingCode: bookings.bookingCode,
    })
    .from(tickets)
    .innerJoin(bookings, eq(bookings.id, tickets.bookingId))
    .where(eq(tickets.id, ticketId))
    .limit(1);
  return row ?? null;
}
