"use server";

import { and, eq, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/db";
import { bookings, boardingEvents, rateCategories, staffUsers } from "@/db/schema";
import { writeAudit } from "@/domain/audit";
import { requireStaff } from "@/lib/auth/guards";
import { hashPassword } from "@/lib/auth/password";
import { revokeAllSessionsFor } from "@/lib/auth/session";

export type StaffState = { error?: string; success?: string };

const createSchema = z.object({
  name: z.string().trim().min(2).max(80),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9._-]{3,32}$/, "invalid username"),
  role: z.enum(["ADMIN", "COUNTER", "SCANNER"]),
  password: z.string().min(10).max(200),
});

export async function createStaffAction(
  _prev: StaffState,
  formData: FormData,
): Promise<StaffState> {
  const actor = await requireStaff(["ADMIN"]);

  const parsed = createSchema.safeParse({
    name: formData.get("name"),
    username: formData.get("username"),
    role: formData.get("role"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return {
      error:
        "Check the details: usernames are 3–32 letters, numbers, dots or dashes, and passwords must be at least 10 characters.",
    };
  }

  const [existing] = await db
    .select({ id: staffUsers.id })
    .from(staffUsers)
    .where(eq(staffUsers.username, parsed.data.username))
    .limit(1);

  if (existing) return { error: "That username is already taken." };

  const [created] = await db
    .insert(staffUsers)
    .values({
      name: parsed.data.name,
      username: parsed.data.username,
      role: parsed.data.role,
      passwordHash: await hashPassword(parsed.data.password),
    })
    .returning();

  await writeAudit(db, {
    actor: { type: "STAFF", id: actor.id, name: actor.name },
    action: "staff.created",
    entity: "staff_user",
    entityId: created!.id,
    after: { username: created!.username, role: created!.role },
  });

  revalidatePath("/admin/staff");
  return { success: `${created!.name} can now sign in as ${created!.username}.` };
}

export async function setStaffActiveAction(
  _prev: StaffState,
  formData: FormData,
): Promise<StaffState> {
  const actor = await requireStaff(["ADMIN"]);
  const id = String(formData.get("staffId") ?? "");
  const active = formData.get("active") === "true";

  if (id === actor.id) {
    return { error: "You cannot deactivate your own account." };
  }

  const [updated] = await db
    .update(staffUsers)
    .set({ active, updatedAt: new Date() })
    .where(eq(staffUsers.id, id))
    .returning();

  if (!updated) return { error: "Staff member not found." };

  // Deactivating must take effect at once, not when the session happens to
  // expire (spec §12).
  if (!active) await revokeAllSessionsFor(id);

  await writeAudit(db, {
    actor: { type: "STAFF", id: actor.id, name: actor.name },
    action: active ? "staff.reactivated" : "staff.deactivated",
    entity: "staff_user",
    entityId: id,
    after: { active },
  });

  revalidatePath("/admin/staff");
  return {
    success: active
      ? `${updated.name} reactivated.`
      : `${updated.name} deactivated and signed out everywhere.`,
  };
}

const editSchema = z.object({
  staffId: z.uuid(),
  name: z.string().trim().min(2).max(80),
  role: z.enum(["ADMIN", "COUNTER", "SCANNER"]),
  // Optional: blank means "leave the password as it is". Rejecting anything
  // shorter than the create-account minimum, rather than silently accepting a
  // weak one, so this form can never leave an account less safe than creating
  // it fresh would have.
  password: z.union([z.string().length(0), z.string().min(10).max(200)]),
});

/**
 * Username is deliberately NOT editable here.
 *
 * It is how a staff member logs in, and it is also what
 * `domain/reports/bookings.ts` joins against to show "sold by" on every past
 * sale — a rename would silently rewrite who every historical booking appears
 * to have been sold by, with no note in the audit trail that it happened. If a
 * username genuinely needs to change, deactivate the old account and create a
 * new one; the history then correctly stays attached to the name it was made
 * under.
 */
export async function editStaffAction(
  _prev: StaffState,
  formData: FormData,
): Promise<StaffState> {
  const actor = await requireStaff(["ADMIN"]);

  const parsed = editSchema.safeParse({
    staffId: formData.get("staffId"),
    name: formData.get("name"),
    role: formData.get("role"),
    password: formData.get("password") ?? "",
  });

  if (!parsed.success) {
    return {
      error: "Check the details: name is required, and a new password must be at least 10 characters.",
    };
  }

  // A role change on your own account could hand yourself a permission you
  // did not have, or — for the only admin left — take away the one that
  // matters. Either way it is a decision someone else should confirm, the
  // same reasoning that already blocks self-deactivation above.
  if (parsed.data.staffId === actor.id && parsed.data.role !== actor.role) {
    return { error: "Ask another admin to change your own role." };
  }

  const [before] = await db
    .select({ name: staffUsers.name, role: staffUsers.role, username: staffUsers.username })
    .from(staffUsers)
    .where(eq(staffUsers.id, parsed.data.staffId))
    .limit(1);

  if (!before) return { error: "Staff member not found." };

  const changingRole = before.role !== parsed.data.role;
  const changingPassword = parsed.data.password.length > 0;

  const [updated] = await db
    .update(staffUsers)
    .set({
      name: parsed.data.name,
      role: parsed.data.role,
      ...(changingPassword ? { passwordHash: await hashPassword(parsed.data.password) } : {}),
      updatedAt: new Date(),
    })
    .where(eq(staffUsers.id, parsed.data.staffId))
    .returning();

  if (!updated) return { error: "Staff member not found." };

  // A role change or a password reset both invalidate what the account is
  // currently trusted to do, so — like deactivating — it must take effect at
  // once rather than waiting for the existing session to expire on its own.
  if (changingRole || changingPassword) await revokeAllSessionsFor(parsed.data.staffId);

  await writeAudit(db, {
    actor: { type: "STAFF", id: actor.id, name: actor.name },
    action: "staff.edited",
    entity: "staff_user",
    entityId: parsed.data.staffId,
    before: { name: before.name, role: before.role },
    after: {
      name: updated.name,
      role: updated.role,
      passwordReset: changingPassword,
    },
  });

  revalidatePath("/admin/staff");
  return {
    success:
      `${updated.name} updated.` +
      (changingRole || changingPassword ? " Signed out everywhere to apply it." : ""),
  };
}

/**
 * Permanently removes a staff account.
 *
 * Deliberately narrower than deactivation, which stays the normal way to
 * remove someone's access (immediate, reversible, and the account's history
 * stays attached to the sales and boardings it made). This exists only for the
 * account that never should have counted as real activity in the first place —
 * a mistyped test login, a duplicate created by a double-submit — where
 * deactivating it would leave a dead entry cluttering this list forever.
 *
 * `bookings.created_by_staff_id`, `rate_categories.created_by_staff_id` and
 * `boarding_events.staff_id` all reference this row with no cascade, so the
 * database itself refuses to delete anyone who ever sold a ticket, priced a
 * rate, or boarded a guest — checked here first so that refusal is a plain
 * sentence instead of a raw constraint-violation error reaching the screen
 * (spec §17).
 */
export async function deleteStaffAction(
  _prev: StaffState,
  formData: FormData,
): Promise<StaffState> {
  const actor = await requireStaff(["ADMIN"]);
  const id = String(formData.get("staffId") ?? "");

  if (id === actor.id) {
    return { error: "You cannot delete your own account." };
  }

  const [target] = await db
    .select({ name: staffUsers.name, username: staffUsers.username, role: staffUsers.role })
    .from(staffUsers)
    .where(eq(staffUsers.id, id))
    .limit(1);

  if (!target) return { error: "Staff member not found." };

  if (target.role === "ADMIN") {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(staffUsers)
      .where(and(eq(staffUsers.role, "ADMIN"), eq(staffUsers.active, true), ne(staffUsers.id, id)));

    if (count === 0) {
      return { error: "This is the last active admin — the park would be locked out. Add another admin first." };
    }
  }

  const [[{ count: soldCount }], [{ count: pricedCount }], [{ count: boardedCount }]] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(bookings)
      .where(eq(bookings.createdByStaffId, id)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(rateCategories)
      .where(eq(rateCategories.createdByStaffId, id)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(boardingEvents)
      .where(eq(boardingEvents.staffId, id)),
  ]);

  if (soldCount > 0 || pricedCount > 0 || boardedCount > 0) {
    return {
      error:
        `${target.name} has a sales or boarding history (${soldCount} sale(s), ` +
        `${boardedCount} boarding(s)) and can't be deleted without losing that record. ` +
        `Deactivate the account instead — it signs them out everywhere immediately.`,
    };
  }

  await db.delete(staffUsers).where(eq(staffUsers.id, id));

  await writeAudit(db, {
    actor: { type: "STAFF", id: actor.id, name: actor.name },
    action: "staff.deleted",
    entity: "staff_user",
    entityId: id,
    before: { username: target.username, role: target.role },
  });

  revalidatePath("/admin/staff");
  return { success: `${target.name} was deleted.` };
}
