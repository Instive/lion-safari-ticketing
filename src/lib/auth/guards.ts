import { redirect } from "next/navigation";

import type { StaffRole } from "@/db/schema";
import { ForbiddenError } from "@/domain/errors";
import { getSessionStaff, type SessionStaff } from "./session";

/**
 * Least privilege (spec §12). ADMIN is the only role that inherits others'
 * abilities; COUNTER staff can never refund and SCANNER staff can never touch
 * payments. Every server action and API route states the role it needs.
 */
export function roleAllows(role: StaffRole, allowed: StaffRole[]): boolean {
  if (allowed.includes(role)) return true;
  return role === "ADMIN";
}

/** For pages: redirects to login instead of throwing. */
export async function requirePageStaff(allowed: StaffRole[]): Promise<SessionStaff> {
  const staff = await getSessionStaff();
  if (!staff) redirect("/login");
  if (!roleAllows(staff.role, allowed)) redirect("/login?denied=1");
  return staff;
}

/** For server actions and route handlers: throws, so callers map it to a 403. */
export async function requireStaff(allowed: StaffRole[]): Promise<SessionStaff> {
  const staff = await getSessionStaff();
  if (!staff) throw new ForbiddenError("no session");
  if (!roleAllows(staff.role, allowed)) {
    throw new ForbiddenError(`role ${staff.role} not in ${allowed.join(",")}`);
  }
  return staff;
}

/** Where each role lands after login. */
export function homeFor(role: StaffRole): string {
  switch (role) {
    case "ADMIN":
      return "/admin";
    case "COUNTER":
      return "/counter";
    case "SCANNER":
      return "/scanner";
  }
}
