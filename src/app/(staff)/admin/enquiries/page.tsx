import Link from "next/link";

import { enquiryStatus, type EnquiryStatus } from "@/db/schema";
import { listGroupEnquiries, type EnquiryListFilter } from "@/domain/enquiry";
import { requirePageStaff } from "@/lib/auth/guards";
import { formatLocalTime, formatVisitDate } from "@/lib/time";
import { EnquiryCard } from "./enquiry-card";

export const metadata = { title: "Group enquiries — Lion Safari" };
export const dynamic = "force-dynamic";

const FILTERS: Array<{ value: EnquiryListFilter; label: string }> = [
  { value: "NEW", label: "New" },
  { value: "CONTACTED", label: "Contacted" },
  { value: "CLOSED", label: "Closed" },
  { value: "ALL", label: "All" },
];

function parseFilter(value: string | undefined): EnquiryListFilter {
  if (value === "ALL") return "ALL";
  return (enquiryStatus.enumValues as readonly string[]).includes(value ?? "")
    ? (value as EnquiryStatus)
    : // Defaults to the ones that still need a person, because that is the
      // only reason to open this screen.
      "NEW";
}

export default async function EnquiriesPage({ searchParams }: PageProps<"/admin/enquiries">) {
  await requirePageStaff(["ADMIN"]);
  const { status } = await searchParams;
  const filter = parseFilter(typeof status === "string" ? status : undefined);
  const enquiries = await listGroupEnquiries(filter);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6">
      <Link href="/admin" className="text-sm text-brand underline">
        ← Dashboard
      </Link>
      <h1 className="mt-3 text-2xl font-semibold">Group enquiries</h1>
      <p className="text-muted mt-1 text-sm">
        Schools and institutions asking about a group visit. Agree a price, then sell it at the
        counter — group rates are not available through online checkout.
      </p>

      <nav className="mt-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Link
            key={f.value}
            href={`/admin/enquiries?status=${f.value}`}
            className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
              filter === f.value
                ? "border-brand bg-brand/5 text-brand"
                : "border-line bg-surface hover:border-brand hover:text-brand"
            }`}
          >
            {f.label}
          </Link>
        ))}
      </nav>

      {enquiries.length === 0 ? (
        <p className="text-muted mt-6 rounded-xl border border-line bg-surface p-6 text-center text-sm">
          Nothing here.
        </p>
      ) : (
        <ul className="mt-4 grid gap-3">
          {enquiries.map((e) => (
            <EnquiryCard
              key={e.id}
              enquiry={{
                id: e.id,
                organisation: e.organisation,
                contactName: e.contactName,
                contactEmail: e.contactEmail,
                contactPhone: e.contactPhone,
                visitorCount: e.visitorCount,
                visitDateLabel: e.visitDate ? formatVisitDate(e.visitDate) : "Not decided",
                message: e.message,
                status: e.status,
                staffNote: e.staffNote,
                createdLabel: formatLocalTime(e.createdAt),
              }}
            />
          ))}
        </ul>
      )}
    </main>
  );
}
