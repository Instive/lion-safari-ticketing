"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { emailReportAction, type ReportActionState } from "./report-actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg border border-line bg-surface px-3 py-2 text-sm font-semibold transition-colors hover:border-brand disabled:opacity-60"
    >
      {pending ? "Queueing…" : "Email me this day"}
    </button>
  );
}

/**
 * On-demand copy of the nightly report. Only offered for a single-day view —
 * the report is defined as one operating day, and pretending otherwise would
 * send something different from what the button says.
 */
export function EmailReportButton({ businessDate }: { businessDate: string }) {
  const [state, formAction] = useActionState<ReportActionState, FormData>(emailReportAction, {});

  return (
    <form action={formAction} className="flex flex-col items-end gap-1">
      <input type="hidden" name="businessDate" value={businessDate} />
      <Submit />
      {state.error ? (
        <p role="alert" className="text-xs text-danger">
          {state.error}
        </p>
      ) : null}
      {state.success ? <p className="text-xs text-ok">{state.success}</p> : null}
    </form>
  );
}
