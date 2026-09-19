"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { submitGroupEnquiryAction, type EnquiryState } from "./actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="mt-2 min-h-14 w-full rounded-xl bg-brand px-4 font-semibold text-white hover:bg-brand-strong disabled:opacity-60"
    >
      {pending ? "Sending…" : "Send enquiry"}
    </button>
  );
}

function Field({
  label,
  name,
  type = "text",
  required = true,
  placeholder,
  hint,
  ...rest
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  placeholder?: string;
  hint?: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium" htmlFor={name}>
        {label}
        {required ? null : <span className="text-muted font-normal"> (optional)</span>}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        required={required}
        placeholder={placeholder}
        className="min-h-12 w-full rounded-lg border border-line bg-surface px-3 text-base outline-none focus:border-brand"
        {...rest}
      />
      {hint ? <p className="text-muted mt-1 text-xs">{hint}</p> : null}
    </div>
  );
}

export function EnquiryForm({
  minVisitors,
  minDate,
  maxDate,
}: {
  minVisitors: number;
  minDate: string;
  maxDate: string;
}) {
  const [state, action] = useActionState<EnquiryState, FormData>(submitGroupEnquiryAction, {});

  if (state.sent) {
    return (
      <div role="status" className="rounded-xl border border-ok/30 bg-ok/5 p-5">
        <p className="font-semibold text-ok">Enquiry sent</p>
        <p className="text-muted mt-1 text-sm">
          Thank you — we have your details and will be in touch within two working days with a
          price for your group. Nothing is booked or held yet.
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="grid gap-5 rounded-2xl border border-line bg-surface p-5 sm:p-8">
      <Field
        label="School or organisation"
        name="organisation"
        placeholder="Green Valley Public School"
      />
      <Field label="Your name" name="contactName" placeholder="Person we should speak to" />
      <Field label="Email" name="contactEmail" type="email" placeholder="you@school.edu" />
      <Field
        label="Mobile number"
        name="contactPhone"
        type="tel"
        inputMode="numeric"
        pattern="[0-9]{10}"
        placeholder="10-digit number"
      />
      <Field
        label="Roughly how many visitors"
        name="visitorCount"
        type="number"
        inputMode="numeric"
        min={1}
        defaultValue={minVisitors}
        hint="An estimate is fine — the final price depends on the group size."
      />
      <Field
        label="Preferred date"
        name="visitDate"
        type="date"
        required={false}
        min={minDate}
        max={maxDate}
        hint="Leave blank if you have not decided yet."
      />

      <div>
        <label className="mb-1 block text-sm font-medium" htmlFor="message">
          Anything else <span className="text-muted font-normal">(optional)</span>
        </label>
        <textarea
          id="message"
          name="message"
          rows={4}
          maxLength={2000}
          placeholder="Age group, accessibility needs, preferred time of day…"
          className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-base outline-none focus:border-brand"
        />
      </div>

      {state.error ? (
        <p role="alert" className="rounded-lg bg-danger/5 px-3 py-2 text-sm text-danger">
          {state.error}
        </p>
      ) : null}

      <Submit />

      <p className="text-muted text-xs">
        Sending this does not book or hold anything. We will confirm a price with you first.
      </p>
    </form>
  );
}
