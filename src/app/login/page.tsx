import { redirect } from "next/navigation";

import { getSessionStaff } from "@/lib/auth/session";
import { homeFor } from "@/lib/auth/guards";
import { LoginForm } from "./login-form";

export const metadata = { title: "Staff sign in — Lion Safari" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const staff = await getSessionStaff();
  if (staff) redirect(homeFor(staff.role));

  const { denied } = await searchParams;

  return (
    <main className="flex-1 grid place-items-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold text-brand">Lion Safari</h1>
          <p className="text-muted mt-1 text-sm">Staff sign in</p>
        </div>

        {denied ? (
          <p className="mb-4 rounded-lg border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
            Your account does not have access to that screen.
          </p>
        ) : null}

        <LoginForm />
      </div>
    </main>
  );
}
