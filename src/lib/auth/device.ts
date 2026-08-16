import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { devices, type Device } from "@/db/schema";
import { sha256 } from "@/lib/codes";

export const DEVICE_KEY_HEADER = "x-device-key";

/**
 * Authenticates a scanner terminal by its API key.
 *
 * Only the key's hash is stored, and deactivating a device in the admin portal
 * locks it out on its very next sync — the recovery path for a lost or stolen
 * gate device (spec §12).
 */
export async function authenticateDevice(headers: Headers): Promise<Device | null> {
  const key = headers.get(DEVICE_KEY_HEADER);
  if (!key) return null;

  const [device] = await db
    .select()
    .from(devices)
    .where(and(eq(devices.apiKeyHash, sha256(key)), eq(devices.active, true)))
    .limit(1);

  return device ?? null;
}

/** 401 with no detail — an unauthenticated caller learns nothing. */
export function deviceUnauthorized(): Response {
  return Response.json({ error: "unauthorized" }, { status: 401 });
}
