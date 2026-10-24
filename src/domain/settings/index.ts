import { eq } from "drizzle-orm";

import { db, type DbOrTx } from "@/db";
import { parkSettings, type ParkSettings } from "@/db/schema";
import { writeAudit, type Actor } from "../audit";

/**
 * Runtime operational switches, as one row.
 *
 * Every reader goes through `getParkSettings` rather than selecting the table
 * directly, so the "no row yet" case has exactly one answer. A fresh database
 * — or one migrated before the seed ran — has no row at all, and a counter
 * route is the wrong place to discover that.
 */

/**
 * The defaults a park runs on before an admin has changed anything.
 *
 * Offline selling defaults to ON because that is how the system behaved before
 * this switch existed: a till that loads its book is the documented behaviour
 * of `/api/counter/book`, and a migration must not silently take a working
 * outage path away from a counter that is relying on it.
 */
const DEFAULTS = {
  offlineSellingEnabled: true,
} as const;

export type ParkSettingsView = {
  offlineSellingEnabled: boolean;
  updatedAt: Date | null;
  updatedByStaffId: string | null;
};

/** Reads the switches, falling back to defaults when the row is absent. */
export async function getParkSettings(dbOrTx: DbOrTx = db): Promise<ParkSettingsView> {
  const [row] = await dbOrTx
    .select()
    .from(parkSettings)
    .where(eq(parkSettings.id, 1))
    .limit(1);

  if (!row) {
    return { ...DEFAULTS, updatedAt: null, updatedByStaffId: null };
  }

  return {
    offlineSellingEnabled: row.offlineSellingEnabled,
    updatedAt: row.updatedAt,
    updatedByStaffId: row.updatedByStaffId,
  };
}

/**
 * Convenience read for the hot path.
 *
 * `/api/counter/book` is called on every counter load by every till, so it asks
 * this one question rather than pulling the whole settings row into a route
 * that does not care about the rest.
 */
export async function isOfflineSellingEnabled(dbOrTx: DbOrTx = db): Promise<boolean> {
  return (await getParkSettings(dbOrTx)).offlineSellingEnabled;
}

/**
 * Flips offline selling park-wide, writing the audit entry in the same
 * transaction as the change.
 *
 * Upsert rather than update: the row may not exist yet on a park that has never
 * touched its settings, and "turn this off" must not silently no-op because a
 * seed step was missed. Returns the value actually stored.
 */
export async function setOfflineSellingEnabled(input: {
  enabled: boolean;
  actor: Actor;
}): Promise<boolean> {
  return db.transaction(async (tx) => {
    const before = await getParkSettings(tx);

    const [row] = await tx
      .insert(parkSettings)
      .values({
        id: 1,
        offlineSellingEnabled: input.enabled,
        updatedByStaffId: input.actor.type === "STAFF" ? input.actor.id : null,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: parkSettings.id,
        set: {
          offlineSellingEnabled: input.enabled,
          updatedByStaffId: input.actor.type === "STAFF" ? input.actor.id : null,
          updatedAt: new Date(),
        },
      })
      .returning();

    // Audited like any other operational change: this one decides whether a
    // till can hand out tickets the gate will admit before anyone has paid,
    // so "who turned it off, and when" has to be answerable afterwards.
    await writeAudit(tx, {
      actor: input.actor,
      action: input.enabled ? "settings.offline_selling_enabled" : "settings.offline_selling_disabled",
      entity: "park_settings",
      entityId: "1",
      before: { offlineSellingEnabled: before.offlineSellingEnabled },
      after: { offlineSellingEnabled: input.enabled },
    });

    return row?.offlineSellingEnabled ?? input.enabled;
  });
}

export type { ParkSettings };
