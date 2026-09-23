"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The shift running total, behind a button instead of across the header.
 *
 * These figures are what the drawer gets checked against, so they have to stay
 * one tap away — but they are also the takings for the whole shift, sitting
 * open on a screen that faces a queue of guests. Staff need them at handover
 * and when a count feels wrong, not continuously while selling, and the sale
 * form is what should own the top of the screen.
 *
 * Deliberately a `<dialog>` rather than a panel: `showModal()` gives the focus
 * trap, the backdrop and Escape-to-close for free, and the totals are a thing
 * you open, read and dismiss rather than work alongside.
 */
export function ShiftTotals({
  sales,
  visitors,
  amount,
  cash,
  upi,
}: {
  sales: number;
  visitors: number;
  amount: string;
  cash: string;
  upi: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className="touch-target flex w-full items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 text-sm font-semibold hover:border-brand"
      >
        <span>Today&rsquo;s sales</span>
        {/* The count alone, not the money: enough to tell at a glance that the
            shift is being recorded, without putting the takings on display. */}
        <span className="text-muted font-medium tabular-nums">
          {sales} {sales === 1 ? "sale" : "sales"} →
        </span>
      </button>

      <dialog
        ref={dialogRef}
        // Closing can also come from Escape or the backdrop, which never run
        // the onClick above — so state is synced from the dialog's own event.
        onClose={() => setOpen(false)}
        onClick={(event) => {
          if (event.target === event.currentTarget) setOpen(false);
        }}
        aria-label="Today's sales"
        className="shift-dialog"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Today&rsquo;s sales</h2>
            <p className="text-muted text-sm">Your shift so far</p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="touch-target grid shrink-0 place-items-center rounded-xl border border-line px-4 text-sm font-semibold hover:border-brand"
          >
            Close
          </button>
        </div>

        <dl className="mt-4 grid grid-cols-3 divide-x divide-line overflow-hidden rounded-xl border border-line">
          <ShiftStat label="Sales" value={String(sales)} />
          <ShiftStat label="Visitors" value={String(visitors)} />
          <ShiftStat label="Taken" value={amount} />
        </dl>

        {/* Split the way it is reconciled: cash against the drawer, UPI against
            the account statement. A single total can only be checked against
            the sum of two documents nobody has side by side. */}
        <dl className="mt-3 grid grid-cols-2 gap-2">
          <Tender label="Cash" value={cash} hint="Check the drawer" />
          <Tender label="UPI" value={upi} hint="Check the statement" />
        </dl>
      </dialog>
    </>
  );
}

function ShiftStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-3 py-2.5 text-center">
      <dt className="text-muted text-[11px] uppercase tracking-wide">{label}</dt>
      <dd className="mt-0.5 text-lg font-bold tabular-nums">{value}</dd>
    </div>
  );
}

function Tender({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-xl border border-line px-3 py-2.5">
      <dt className="text-muted text-xs">{label}</dt>
      <dd className="mt-0.5 text-base font-bold tabular-nums">{value}</dd>
      <p className="text-muted mt-0.5 text-[11px]">{hint}</p>
    </div>
  );
}
