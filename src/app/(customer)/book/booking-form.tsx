"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";

import { formatPaise } from "@/lib/money";
import { startBookingAction, type BookingState } from "./actions";

/**
 * Whether an ISO date is a Monday, computed without a timezone library.
 *
 * `new Date("2026-09-07")` parses as UTC midnight, which can land on the
 * previous day in a negative-offset zone — but the park's zone is Asia/Kolkata
 * (UTC+5:30), so constructing the parts explicitly in local time avoids the
 * whole question. This is a hint for the customer only; the server's
 * `isClosedDay` in park time is what actually decides (spec §6).
 */
function isMonday(isoDate: string): boolean {
  const [y, m, d] = isoDate.split("-").map(Number);
  if (!y || !m || !d) return false;
  return new Date(y, m - 1, d, 12, 0, 0).getDay() === 1;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/**
 * "Thu, 10 Sep 2026" for the summary line.
 *
 * Formatted here rather than passed in, because the guest changes the date
 * without a round trip. Built from the date parts at midday local time — the
 * same trick `isMonday` uses — so no timezone can shift it a day. The park's
 * own timezone still governs everything that matters; this label is only
 * echoing back what the guest just picked.
 */
function formatPickedDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  if (!y || !m || !d) return isoDate;
  // Built by hand rather than with toLocaleDateString: no locale gives both
  // day-first order AND a three-letter month, so en-IN/en-GB render September
  // as "Sept" while the ticket and email print "Sep". A guest comparing the
  // summary to the ticket that follows should see the same string.
  const at = new Date(y, m - 1, d, 12, 0, 0);
  return `${DAYS[at.getDay()]}, ${d} ${MONTHS[m - 1]} ${y}`;
}

type Props = {
  perVisitorPaise: number;
  convenienceFeePaise: number;
  maxVisitors: number;
  /** Today in park time — the earliest bookable day. */
  minVisitDate: string;
  /** The furthest day ahead bookings are open for. */
  maxVisitDate: string;
  /** What the picker opens on: today, or the next open day if today is closed. */
  defaultVisitDate: string;
  /**
   * Passed in rather than imported: `@/domain/booking/visit-date` pulls in
   * `@/lib/env`, which throws the moment it loads in a browser.
   */
  maxAdvanceDays: number;
  /**
   * Minted on the server for this render. Re-submitting from the same page —
   * a double tap, or a retry after an abandoned checkout — reuses it and so
   * reuses the same booking rather than creating another.
   */
  idempotencyKey: string;
};

declare global {
  interface Window {
    Cashfree?: (opts: { mode: string }) => {
      checkout: (opts: { paymentSessionId: string; redirectTarget?: string }) => void;
    };
  }
}

/**
 * Cashfree's hosted checkout. Card details are entered on their page, never on
 * ours, so no card data ever reaches this application (spec §4.3).
 */
let sdkPromise: Promise<void> | null = null;

function loadCashfreeSdk(): Promise<void> {
  sdkPromise ??= new Promise<void>((resolve, reject) => {
    const existing = document.getElementById("cashfree-sdk");
    if (existing) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.id = "cashfree-sdk";
    script.src = "https://sdk.cashfree.com/js/v3/cashfree.js";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Cashfree SDK failed to load"));
    document.head.appendChild(script);
  });
  return sdkPromise;
}

function PayButton({ total, disabled }: { total: string; disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className="touch-target w-full rounded-xl bg-brand px-4 text-base font-semibold text-white shadow-sm transition-colors hover:bg-brand-strong disabled:cursor-not-allowed disabled:opacity-50"
    >
      {pending ? "Opening secure checkout…" : `Pay ${total}`}
    </button>
  );
}

/** A numbered step heading, so the form reads as a sequence rather than a wall. */
function StepHeading({ step, title, hint }: { step: number; title: string; hint?: string }) {
  return (
    <div className="mb-4 flex items-start gap-3">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand text-sm font-bold text-white">
        {step}
      </span>
      <div className="min-w-0">
        <h2 className="font-semibold leading-tight">{title}</h2>
        {hint ? <p className="text-muted mt-0.5 text-sm">{hint}</p> : null}
      </div>
    </div>
  );
}

/** Labelled text input — a placeholder alone disappears once typing starts. */
function Field({
  label,
  name,
  hint,
  ...rest
}: {
  label: string;
  name: string;
  hint?: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div>
      <label htmlFor={name} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      <input
        id={name}
        name={name}
        className="touch-target w-full rounded-lg border border-line bg-background px-3 text-base outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/20"
        {...rest}
      />
      {hint ? <p className="text-muted mt-1 text-xs">{hint}</p> : null}
    </div>
  );
}

export function BookingForm({
  perVisitorPaise,
  convenienceFeePaise,
  maxVisitors,
  minVisitDate,
  maxVisitDate,
  defaultVisitDate,
  maxAdvanceDays,
  idempotencyKey,
}: Props) {
  const [state, formAction] = useActionState<BookingState, FormData>(startBookingAction, {});
  const [visitors, setVisitors] = useState(2);
  const [visitDate, setVisitDate] = useState(defaultVisitDate);
  const [confirmed, setConfirmed] = useState(false);

  // Mirrors the server's closed-day rule so the customer is told before paying
  // rather than after submitting. The server re-checks regardless.
  const closedDaySelected = isMonday(visitDate);

  // Warm the SDK up front so tapping Pay opens checkout without a wait.
  useEffect(() => {
    void loadCashfreeSdk().catch(() => {});
  }, []);

  useEffect(() => {
    const checkout = state.checkout;
    if (!checkout) return;

    let cancelled = false;
    void (async () => {
      try {
        await loadCashfreeSdk();
      } catch {
        return;
      }
      if (cancelled || !window.Cashfree) return;
      window.Cashfree({ mode: checkout.mode }).checkout({
        paymentSessionId: checkout.paymentSessionId,
        redirectTarget: "_self",
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [state.checkout]);

  const subtotal = visitors * perVisitorPaise;
  const total = subtotal + convenienceFeePaise;

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="visitorCount" value={visitors} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />

      <section className="rounded-xl border border-line bg-surface p-5 shadow-sm">
        <StepHeading
          step={1}
          title="When are you visiting?"
          hint={`Book up to ${maxAdvanceDays} days ahead. Closed on Mondays.`}
        />

        <input
          type="date"
          name="visitDate"
          aria-label="Visit date"
          value={visitDate}
          min={minVisitDate}
          max={maxVisitDate}
          required
          onChange={(e) => setVisitDate(e.target.value)}
          className="touch-target w-full rounded-lg border border-line bg-background px-3 text-base outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/20"
        />

        {closedDaySelected ? (
          <p role="alert" className="text-danger mt-2 text-sm font-medium">
            The park is closed on Mondays. Please choose another date.
          </p>
        ) : null}
      </section>

      <section className="rounded-xl border border-line bg-surface p-5 shadow-sm">
        <StepHeading step={2} title="How many visitors?" />

        {/* The single most common way to overpay is counting a toddler, so this
            is a callout rather than a line of helper text. */}
        <div className="mb-5 flex items-start gap-2.5 rounded-lg border border-brand/25 bg-brand/5 p-3">
          <span aria-hidden className="text-lg leading-none">
            👶
          </span>
          <p className="text-sm leading-snug">
            <span className="font-semibold text-brand">Children under 3 enter free.</span>{" "}
            <span className="text-muted">Please do not include them in the count below.</span>
          </p>
        </div>

        <div className="flex items-center justify-center gap-5">
          <button
            type="button"
            onClick={() => setVisitors((v) => Math.max(1, v - 1))}
            className="touch-target w-16 rounded-xl border border-line text-2xl font-bold"
            aria-label="One fewer visitor"
          >
            −
          </button>
          <output className="min-w-20 text-center text-4xl font-bold tabular-nums">
            {visitors}
          </output>
          <button
            type="button"
            onClick={() => setVisitors((v) => Math.min(maxVisitors, v + 1))}
            className="touch-target w-16 rounded-xl border border-line text-2xl font-bold"
            aria-label="One more visitor"
          >
            +
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-line bg-surface p-5 shadow-sm">
        <StepHeading step={3} title="Your details" />

        <div className="space-y-4">
          <Field
            label="Full name"
            name="customerName"
            placeholder="As it should appear on the ticket"
            autoComplete="name"
            required
            maxLength={120}
          />
          <Field
            label="Mobile number"
            name="customerPhone"
            placeholder="10-digit number"
            inputMode="numeric"
            autoComplete="tel"
            required
            maxLength={10}
            hint="Used to look up your ticket if you lose it."
          />
          <Field
            label="Email address"
            name="customerEmail"
            type="email"
            placeholder="you@example.com"
            autoComplete="email"
            required
            maxLength={200}
            hint="Your ticket is sent here. No account needed."
          />
        </div>
      </section>

      {/* The full payable amount is shown before payment (spec §17). */}
      <section className="rounded-xl border border-line bg-surface p-5 shadow-sm">
        <h2 className="mb-4 font-semibold">Booking summary</h2>
        <dl className="space-y-2.5 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-muted">Visit date</dt>
            <dd className="text-right font-medium">{formatPickedDate(visitDate)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted">
              {visitors} {visitors === 1 ? "visitor" : "visitors"} ×{" "}
              {formatPaise(perVisitorPaise)}
            </dt>
            <dd className="font-medium tabular-nums">{formatPaise(subtotal)}</dd>
          </div>
          {convenienceFeePaise > 0 ? (
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Convenience fee</dt>
              <dd className="font-medium tabular-nums">{formatPaise(convenienceFeePaise)}</dd>
            </div>
          ) : null}
          <div className="flex justify-between gap-4 border-t border-line pt-3 text-lg font-bold">
            <dt>Total payable</dt>
            <dd className="tabular-nums">{formatPaise(total)}</dd>
          </div>
        </dl>
      </section>

      {state.error ? (
        <p
          role="alert"
          className="rounded-lg border border-danger/30 bg-danger/5 px-4 py-3 text-sm font-medium text-danger"
        >
          {state.error}
        </p>
      ) : null}

      {/*
        A deliberate pause before money moves. The visit date and visitor count
        are both fixed at booking and neither is refundable, so this is the last
        point at which a wrong date costs nothing to fix.
      */}
      <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line bg-surface p-4 shadow-sm transition-colors has-[:checked]:border-brand/40 has-[:checked]:bg-brand/5">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--color-brand,#14603c)]"
        />
        <span className="text-sm leading-snug">
          I confirm the visit date, visitor count and contact details above are correct.
          Tickets are valid only for the date shown and are non-refundable.
        </span>
      </label>

      <PayButton total={formatPaise(total)} disabled={!confirmed || closedDaySelected} />

      <p className="text-muted text-center text-xs leading-relaxed">
        Pay securely by UPI or card. Your ticket is issued once payment is confirmed,
        and emailed to you straight away.
      </p>
    </form>
  );
}
