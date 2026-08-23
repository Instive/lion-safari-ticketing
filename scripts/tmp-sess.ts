import { randomBytes, createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { staffSessions, staffUsers } from "@/db/schema";
import { env } from "@/lib/env";
async function main() {
  const [u] = await db.select().from(staffUsers).where(eq(staffUsers.username, "counter")).limit(1);
  const raw = randomBytes(32).toString("base64url");
  await db.insert(staffSessions).values({ staffId: u!.id, tokenHash: createHmac("sha256", env.SESSION_SECRET).update(raw).digest("hex"), expiresAt: new Date(Date.now()+3600_000) });
  console.log(raw);
  await pool.end();
}
main();
