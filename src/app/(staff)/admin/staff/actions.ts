"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/db";
import { staffUsers } from "@/db/schema";
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
