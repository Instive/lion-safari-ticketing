import Link from "next/link";

import { bookableRange } from "@/domain/booking/visit-date";
import { GROUP_ENQUIRY_MIN_VISITORS } from "@/domain/enquiry";
import { EnquiryForm } from "./enquiry-form";

export const metadata = { title: "School & group visits — Chhatbir Zoo" };

/**
 * The enquiry route for schools and institutions.
 *
 * Kept separate from `/book` on purpose. Online checkout sells at the standard
 * fare and confirms itself; a group visit is priced by a person after seeing
 * the numbers and, for a concession, the paperwork. Mixing the two would mean
 * either quoting a price nobody has agreed to or holding seats against money
 * that may never arrive.
 */
export default function GroupsPage() {
  const { min, max } = bookableRange();

  return (
    <main className="mx-auto w-full max-w-md px-4 py-8">
      <div className="mb-6">
        <Link href="/" className="text-muted text-sm hover:text-foreground">
          ← Back
        </Link>
        <h1 className="mt-2 font-display text-4xl tracking-wide text-brand">School &amp; Groups</h1>
        <p className="text-muted mt-3 text-sm">
          Bringing a school, college or large group? Group rates depend on how many are coming, so
          tell us a little about your visit and we will come back with a price.
        </p>
      </div>

      <div className="mb-6 rounded-xl border border-line bg-surface p-4 text-sm">
        <p className="font-medium">How it works</p>
        <ol className="text-muted mt-2 grid gap-1.5 list-decimal pl-4">
          <li>Send us the details below.</li>
          <li>We reply with a price for your group size.</li>
          <li>Once agreed, your tickets are issued at the counter on the day.</li>
        </ol>
      </div>

      <p className="text-muted mb-4 text-sm">
        Groups of fewer than {GROUP_ENQUIRY_MIN_VISITORS} are usually quicker to{" "}
        <Link href="/book" className="text-brand underline">
          book online
        </Link>{" "}
        at the standard fare.
      </p>

      <EnquiryForm
        minVisitors={GROUP_ENQUIRY_MIN_VISITORS}
        minDate={min}
        maxDate={max}
      />
    </main>
  );
}
