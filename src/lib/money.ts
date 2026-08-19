/**
 * All amounts move through the system as integer paise. These helpers are the
 * only place rupees appear, and they are display-only.
 */

export function formatPaise(paise: number): string {
  const sign = paise < 0 ? "-" : "";
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100);
  const remainder = abs % 100;
  return `${sign}₹${rupees.toLocaleString("en-IN")}.${String(remainder).padStart(2, "0")}`;
}

/** Cashfree and most gateways take a decimal rupee amount. */
export function paiseToRupeeString(paise: number): string {
  return (paise / 100).toFixed(2);
}

export function rupeeStringToPaise(rupees: string | number): number {
  return Math.round(Number(rupees) * 100);
}

/**
 * Display-only, for marketing copy where a whole-rupee fare reads better
 * without the trailing paise ("₹75" rather than "₹75.00"). Any amount that is
 * not a whole number of rupees still shows in full.
 */
export function formatPaiseCompact(paise: number): string {
  return paise % 100 === 0 ? formatPaise(paise).replace(/\.00$/, "") : formatPaise(paise);
}
