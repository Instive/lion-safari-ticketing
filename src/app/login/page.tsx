import { redirect } from "next/navigation";

import { BrandMark } from "@/components/staff/brand-mark";
import { EnvBanner } from "@/components/staff/env-banner";
import { getSessionStaff } from "@/lib/auth/session";
import { homeFor } from "@/lib/auth/guards";
import { LoginForm } from "./login-form";

export const metadata = { title: "Staff sign in — Lion Safari" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const staff = await getSessionStaff();
  if (staff) redirect(homeFor(staff.role));

  const { denied, expired } = await searchParams;

  return (
    <>
      <EnvBanner />
      <main className="flex-1 grid place-items-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-4 text-center">
          <BrandMark size="lg" />
          <p className="text-muted text-sm">Staff sign in</p>
        </div>

        {expired ? (
          <p className="mb-4 rounded-lg border border-accent/30 bg-accent/5 px-4 py-3 text-sm text-accent">
            Your session ended. Please sign in again — nothing you entered was lost.
          </p>
        ) : denied ? (
          <p className="mb-4 rounded-lg border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
            Your account does not have access to that screen.
          </p>
        ) : null}

        <LoginForm />
      </div>
      </main>
    </>
  );
}
