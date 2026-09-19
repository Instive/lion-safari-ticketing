import { desc, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { groupEnquiries, type EnquiryStatus, type GroupEnquiry } from "@/db/schema";
import { writeAudit, type Actor } from "../audit";
import { DomainError } from "../errors";

/**
 * Group and institutional enquiries.
 *
 * The whole point of this module is that it never prices anything. A school
 * rate depends on volume and on a person checking a letterhead, and
 * `booking/pricing.ts` refuses a non-standard rate on the ONLINE channel for
 * exactly that reason. Rather than weaken that rule, an enquiry is kept as a
 * lead: it records who asked and for roughly what, and the sale is made later
 * at the counter, where concession pricing already exists with a cap and an
 * audit trail.
 *
 * Nothing here holds a seat or issues a ticket.
 */

/**
 * Below this, an enquirer should simply book online at the standard fare
 * rather than wait for a call back. Used by the form to steer people to the
 * faster path; it is not a rule about who may enquire, so it is not enforced
 * server-side beyond the message the UI shows.
 */
export const GROUP_ENQUIRY_MIN_VISITORS = 15;

export type CreateEnquiryInput = {
  organisation: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  visitorCount: number;
  /** Null when the enquirer has not settled on a date. */
  visitDate: string | null;
  message: string | null;
};

export async function createGroupEnquiry(input: CreateEnquiryInput): Promise<GroupEnquiry> {
  // Defence in depth: the form validates too, but this module owns the rule.
  if (!Number.isInteger(input.visitorCount) || input.visitorCount < 1) {
    throw new DomainError("INVALID_VISITOR_COUNT", "Please tell us roughly how many are coming.");
  }

  const [row] = await db
    .insert(groupEnquiries)
    .values({
      organisation: input.organisation,
      contactName: input.contactName,
      contactEmail: input.contactEmail,
      contactPhone: input.contactPhone,
      visitorCount: input.visitorCount,
      visitDate: input.visitDate,
      message: input.message,
    })
    .returning();

  // Written outside a transaction with the insert only because there is no
  // second write to keep consistent with — the enquiry IS the record. An
  // audit row still means an operator can see when a lead arrived and, later,
  // who touched it.
  await writeAudit(db, {
    actor: { type: "CUSTOMER" },
    action: "enquiry.created",
    entity: "enquiry",
    entityId: row!.id,
    context: {
      organisation: input.organisation,
      visitorCount: input.visitorCount,
      visitDate: input.visitDate,
    },
  });

  return row!;
}

export type EnquiryListFilter = EnquiryStatus | "ALL";

export async function listGroupEnquiries(filter: EnquiryListFilter = "ALL") {
  const query = db.select().from(groupEnquiries).$dynamic();
  const rows =
    filter === "ALL"
      ? await query.orderBy(desc(groupEnquiries.createdAt)).limit(200)
      : await query
          .where(eq(groupEnquiries.status, filter))
          .orderBy(desc(groupEnquiries.createdAt))
          .limit(200);
  return rows;
}

/** How many still need someone to pick them up — for the admin nav badge. */
export async function countNewEnquiries(): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(groupEnquiries)
    .where(eq(groupEnquiries.status, "NEW"));
  return row?.count ?? 0;
}

export async function getGroupEnquiry(id: string): Promise<GroupEnquiry | undefined> {
  const [row] = await db.select().from(groupEnquiries).where(eq(groupEnquiries.id, id)).limit(1);
  return row;
}

/**
 * Records progress on an enquiry: who is handling it, what was agreed, and
 * whether it is done. Free-text rather than structured, because what matters
 * on a call back ("head teacher will confirm numbers Monday") does not fit a
 * set of fields — and nothing here is used to price a sale.
 */
export async function updateGroupEnquiry(
  id: string,
  input: { status: EnquiryStatus; staffNote: string | null },
  actor: Actor,
): Promise<void> {
  const existing = await getGroupEnquiry(id);
  if (!existing) throw new DomainError("NOT_FOUND", "We could not find that enquiry.");

  await db
    .update(groupEnquiries)
    .set({
      status: input.status,
      staffNote: input.staffNote,
      handledByStaffId: actor.type === "STAFF" ? actor.id : existing.handledByStaffId,
      updatedAt: new Date(),
    })
    .where(eq(groupEnquiries.id, id));

  await writeAudit(db, {
    actor,
    action: "enquiry.updated",
    entity: "enquiry",
    entityId: id,
    before: { status: existing.status },
    after: { status: input.status },
    context: { note: input.staffNote },
  });
}
