import Link from "next/link";

import { env } from "@/lib/env";
import { RecoverForm } from "./recover-form";

export const metadata = { title: "Find my ticket — Chhatbir Zoo" };
export const dynamic = "force-dynamic";

export default function RecoverTicketPage() {
  return (
    <main className="mx-auto w-full max-w-md px-4 py-8">
      <Link href="/" className="text-muted text-sm hover:text-foreground">
        ← Back
      </Link>
      <h1 className="mt-2 font-display text-4xl tracking-wide text-brand">Find My Ticket</h1>
      <p className="text-muted mt-1 mb-6 text-sm">
        Enter your booking code and the mobile number you booked with.
      </p>

      <RecoverForm />

      <p className="text-muted mt-6 text-center text-xs">
        Your booking code looks like LS7K2M9Q and is in your confirmation email.
        {env.SUPPORT_PHONE ? ` Still stuck? Call ${env.SUPPORT_PHONE}` : ""}
      </p>
    </main>
  );
}
