"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/db";
import { devices } from "@/db/schema";
import { writeAudit } from "@/domain/audit";
import { generateApiKey, sha256 } from "@/lib/codes";
import { requireStaff } from "@/lib/auth/guards";

export type DeviceState = {
  error?: string;
  success?: string;
  /** Shown exactly once, right after registration. Only its hash is stored. */
  apiKey?: string;
};

const registerSchema = z.object({
  name: z.string().trim().min(2).max(80),
  type: z.enum(["SCANNER", "COUNTER"]),
});

export async function registerDeviceAction(
  _prev: DeviceState,
  formData: FormData,
): Promise<DeviceState> {
  const staff = await requireStaff(["ADMIN"]);

  const parsed = registerSchema.safeParse({
    name: formData.get("name"),
    type: formData.get("type"),
  });
  if (!parsed.success) return { error: "Please give the device a name." };

  const apiKey = generateApiKey();
  const [device] = await db
    .insert(devices)
    .values({
      name: parsed.data.name,
      type: parsed.data.type,
      apiKeyHash: sha256(apiKey),
    })
    .returning();

  await writeAudit(db, {
    actor: { type: "STAFF", id: staff.id, name: staff.name },
    action: "device.registered",
    entity: "device",
    entityId: device!.id,
    after: { name: device!.name, type: device!.type },
  });

  revalidatePath("/admin/devices");
  return {
    apiKey,
    success: `${device!.name} registered. Copy the key now — it cannot be shown again.`,
  };
}

export async function setDeviceActiveAction(
  _prev: DeviceState,
  formData: FormData,
): Promise<DeviceState> {
  const staff = await requireStaff(["ADMIN"]);
  const id = String(formData.get("deviceId") ?? "");
  const active = formData.get("active") === "true";

  const [updated] = await db
    .update(devices)
    .set({ active })
    .where(eq(devices.id, id))
    .returning();

  if (!updated) return { error: "Device not found." };

  await writeAudit(db, {
    actor: { type: "STAFF", id: staff.id, name: staff.name },
    action: active ? "device.reactivated" : "device.deactivated",
    entity: "device",
    entityId: id,
    after: { active },
  });

  revalidatePath("/admin/devices");
  return {
    success: active
      ? `${updated.name} reactivated.`
      : `${updated.name} deactivated — it is locked out on its next sync.`,
  };
}
