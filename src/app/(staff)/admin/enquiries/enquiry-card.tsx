"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import type { EnquiryStatus } from "@/db/schema";
import { updateEnquiryAction, type EnquiryUpdateState } from "./actions";

const TONES: Record<EnquiryStatus, string> = {
  NEW: "bg-accent/10 text-accent",
  CONTACTED: "bg-brand/10 text-brand",
  CLOSED: "bg-muted/10 text-muted",
};

const LABELS: Record<EnquiryStatus, string> = {
  NEW: "New",
  CONTACTED: "Contacted",
  CLOSED: "Closed",
};

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="touch-target rounded-lg border border-line bg-surface px-4 text-sm font-semibold hover:bg-background disabled:opacity-60"
    >
      {pending ? "Saving…" : "Save"}
    </button>
  );
}

export function EnquiryCard({
  enquiry,
}: {
  enquiry: {
    id: string;
    organisation: string;
    contactName: string;
    contactEmail: string;
    contactPhone: string;
    visitorCount: number;
    visitDateLabel: string;
    message: string | null;
    status: EnquiryStatus;
    staffNote: string | null;
    createdLabel: string;
  };
}) {
  const [state, action] = useActionState<EnquiryUpdateState, FormData>(updateEnquiryAction, {});

  return (
    <li className="rounded-xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">{enquiry.organisation}</h2>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${TONES[enquiry.status]}`}>
          {LABELS[enquiry.status]}
        </span>
      </div>

      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted text-xs">Contact</dt>
          <dd className="font-medium">{enquiry.contactName}</dd>
        </div>
        <div>
          <dt className="text-muted text-xs">Group size</dt>
          <dd className="font-medium tabular-nums">{enquiry.visitorCount}</dd>
        </div>
        <div>
          <dt className="text-muted text-xs">Email</dt>
          <dd>
            {/* Tap-to-act on a phone: this list is worked through by calling people. */}
            <a href={`mailto:${enquiry.contactEmail}`} className="font-medium text-brand underline">
              {enquiry.contactEmail}
            </a>
          </dd>
        </div>
        <div>
          <dt className="text-muted text-xs">Phone</dt>
          <dd>
            <a href={`tel:${enquiry.contactPhone}`} className="font-medium text-brand underline">
              {enquiry.contactPhone}
            </a>
          </dd>
        </div>
        <div>
          <dt className="text-muted text-xs">Preferred date</dt>
          <dd className="font-medium">{enquiry.visitDateLabel}</dd>
        </div>
        <div>
          <dt className="text-muted text-xs">Received</dt>
          <dd className="font-medium">{enquiry.createdLabel}</dd>
        </div>
      </dl>

      {enquiry.message ? (
        <p className="text-muted mt-3 whitespace-pre-wrap rounded-lg bg-background px-3 py-2 text-sm">
          {enquiry.message}
        </p>
      ) : null}

      <form action={action} className="mt-4 border-t border-line pt-3">
        <input type="hidden" name="id" value={enquiry.id} />
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="text-muted mb-1 block text-xs" htmlFor={`status-${enquiry.id}`}>
              Status
            </label>
            <select
              id={`status-${enquiry.id}`}
              name="status"
              defaultValue={enquiry.status}
              className="touch-target rounded-lg border border-line bg-surface px-3 text-sm"
            >
              {(Object.keys(LABELS) as EnquiryStatus[]).map((s) => (
                <option key={s} value={s}>
                  {LABELS[s]}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-48 flex-1">
            <label className="text-muted mb-1 block text-xs" htmlFor={`note-${enquiry.id}`}>
              Note
            </label>
            <input
              id={`note-${enquiry.id}`}
              name="staffNote"
              defaultValue={enquiry.staffNote ?? ""}
              placeholder="Price quoted, who you spoke to…"
              className="touch-target w-full rounded-lg border border-line bg-surface px-3 text-sm outline-none focus:border-brand"
            />
          </div>
          <Submit />
        </div>

        {state.error ? (
          <p role="alert" className="mt-2 text-sm text-danger">
            {state.error}
          </p>
        ) : null}
        {state.success ? <p className="mt-2 text-sm text-ok">{state.success}</p> : null}
      </form>
    </li>
  );
}
