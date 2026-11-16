import { redirect } from "next/navigation";

import { homeFor, requirePageStaff } from "@/lib/auth/guards";

export default async function StaffHome() {
  const staff = await requirePageStaff(["COUNTER", "SCANNER", "ADMIN"]);
  redirect(homeFor(staff.role));
}
