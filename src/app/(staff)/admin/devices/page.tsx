import { desc } from "drizzle-orm";
import Link from "next/link";

import { db } from "@/db";
import { devices } from "@/db/schema";
import { getParkSettings } from "@/domain/settings";
import { requirePageStaff } from "@/lib/auth/guards";
import { formatLocalTime } from "@/lib/time";
import { DeviceManager } from "./device-manager";
import { OfflineSwitch } from "./offline-switch";

export const metadata = { title: "Devices — Lion Safari" };
export const dynamic = "force-dynamic";

export default async function DevicesPage() {
  await requirePageStaff(["ADMIN"]);

  const [rows, settings] = await Promise.all([
    db.select().from(devices).orderBy(desc(devices.createdAt)),
    getParkSettings(),
  ]);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6">
      <div className="mb-5 flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">Devices</h1>
        <Link href="/admin" className="text-sm text-brand underline">
          ← Dashboard
        </Link>
      </div>

      <p className="text-muted mb-5 text-sm">
        The gate scanner authenticates with a device key. Keys are stored only as hashes and are
        shown once, so an existing key cannot be looked up here — to give a staff member a key,
        reissue it and hand over the new one. Deactivating a device locks it out on its next sync —
        use that if a terminal is lost or stolen.
      </p>

      <OfflineSwitch enabled={settings.offlineSellingEnabled} />

      <DeviceManager
        devices={rows.map((d) => ({
          id: d.id,
          name: d.name,
          type: d.type,
          active: d.active,
          lastSync: d.lastSyncAt ? formatLocalTime(d.lastSyncAt) : null,
        }))}
      />
    </main>
  );
}
