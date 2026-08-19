import Link from "next/link";
import { redirect } from "next/navigation";

import { homeFor } from "@/lib/auth/guards";
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
            {/* Not "/" — the public site may be on a different host, where the
                staff host serves no home page. */}
            <Link href={homeFor(staff.role)} className="font-semibold text-brand">
              Lion Safari
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
