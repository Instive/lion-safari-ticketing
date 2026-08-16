/**
 * Seeds the staff accounts and the gate scanner device.
 *
 * Dev passwords come from the defaults below; in production pass real ones:
 *   ADMIN_PASSWORD=... npm run db:seed
 * The device API key is printed ONCE and only its hash is stored.
 */
import { eq } from "drizzle-orm";

import { db, pool } from "@/db";
import { devices, staffUsers } from "@/db/schema";
import { generateApiKey, sha256 } from "@/lib/codes";
import { hashPassword } from "@/lib/auth/password";

async function upsertStaff(
  username: string,
  name: string,
  role: "ADMIN" | "COUNTER" | "SCANNER",
  password: string,
) {
  const [existing] = await db
    .select()
    .from(staffUsers)
    .where(eq(staffUsers.username, username))
    .limit(1);

  if (existing) {
    console.log(`  staff ${username} already exists — left unchanged`);
    return existing;
  }

  const [created] = await db
    .insert(staffUsers)
    .values({ username, name, role, passwordHash: await hashPassword(password) })
    .returning();

  console.log(`  created ${role} "${username}" with password: ${password}`);
  return created!;
}

async function main() {
  console.log("Seeding staff accounts…");
  await upsertStaff("admin", "Park Administrator", "ADMIN", process.env.ADMIN_PASSWORD ?? "admin12345");
  await upsertStaff("counter", "Counter Staff", "COUNTER", process.env.COUNTER_PASSWORD ?? "counter12345");
  await upsertStaff("gate", "Gate Staff", "SCANNER", process.env.SCANNER_PASSWORD ?? "gate12345");

  console.log("\nSeeding gate scanner device…");
  const [existingDevice] = await db
    .select()
    .from(devices)
    .where(eq(devices.name, "Gate Scanner 1"))
    .limit(1);

  if (existingDevice) {
    console.log("  device already registered — API key cannot be re-shown; re-register to rotate");
  } else {
    const apiKey = generateApiKey();
    await db.insert(devices).values({
      name: "Gate Scanner 1",
      type: "SCANNER",
      apiKeyHash: sha256(apiKey),
    });
    console.log("  Gate Scanner 1 registered.");
    console.log(`\n  DEVICE API KEY (shown once, copy it now):\n    ${apiKey}\n`);
  }

  console.log("Done.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
