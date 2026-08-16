"use client";

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="touch-target rounded-xl border border-line bg-surface px-4 font-semibold hover:bg-background"
    >
      Print
    </button>
  );
}
