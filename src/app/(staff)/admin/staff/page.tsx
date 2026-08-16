import { asc } from "drizzle-orm";
import Link from "next/link";

import { db } from "@/db";
import { staffUsers } from "@/db/schema";
import { requirePageStaff } from "@/lib/auth/guards";
import { StaffManager } from "./staff-manager";

export const metadata = { title: "Staff — Lion Safari" };
export const dynamic = "force-dynamic";

export default async function StaffPage() {
  const me = await requirePageStaff(["ADMIN"]);

  const rows = await db
    .select({
      id: staffUsers.id,
      name: staffUsers.name,
      username: staffUsers.username,
      role: staffUsers.role,
      active: staffUsers.active,
    })
    .from(staffUsers)
    .orderBy(asc(staffUsers.username));

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6">
      <div className="mb-5 flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">Staff</h1>
        <Link href="/admin" className="text-sm text-brand underline">
          ← Dashboard
        </Link>
      </div>

      <p className="text-muted mb-5 text-sm">
        Counter staff can sell tickets but cannot refund. Scanner staff can only record boardings.
        Only admins can move money.
      </p>

      <StaffManager staff={rows} currentStaffId={me.id} />
    </main>
  );
}
