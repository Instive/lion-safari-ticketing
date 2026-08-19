import Link from "next/link";
import { redirect } from "next/navigation";

import { BrandMark } from "@/components/staff/brand-mark";
import { getSessionStaff } from "@/lib/auth/session";
import { signOutAction } from "./actions";

export default async function StaffLayout({ children }: LayoutProps<"/">) {
  const staff = await getSessionStaff();
  if (!staff) redirect("/login");

  return (
    <>
      <header className="no-print border-b border-line bg-surface">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-4">
            {/* The staff launcher, not the public home — on a split host "/"
                is the customer site and is not served here. */}
            <Link href="/staff" aria-label="Staff home">
              <BrandMark size="sm" />
            </Link>
            <nav className="flex gap-3 text-sm">
              {staff.role === "ADMIN" ? (
                <Link href="/admin" className="text-muted hover:text-foreground">
                  Admin
                </Link>
              ) : null}
              {staff.role === "ADMIN" || staff.role === "COUNTER" ? (
                <Link href="/counter" className="text-muted hover:text-foreground">
                  Counter
                </Link>
              ) : null}
            </nav>
          </div>

          <div className="flex items-center gap-3 text-sm">
            <span className="text-muted hidden sm:inline">
              {staff.name} · {staff.role.toLowerCase()}
            </span>
            <form action={signOutAction}>
              <button type="submit" className="rounded-lg border border-line px-3 py-1.5 hover:bg-background">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <div className="flex-1">{children}</div>
    </>
  );
}
