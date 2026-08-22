/**
 * CSV for spreadsheets, not for machines.
 *
 * Two things this gets right that a naive `join(",")` does not:
 *
 * 1. Formula injection. Excel and Sheets treat a cell starting with =, +, -, @
 *    as a formula, so a customer who books under the name `=HYPERLINK(...)` gets
 *    their payload executed on the admin's machine when they open the export.
 *    Prefixing with an apostrophe makes it inert text and is invisible in the
 *    cell. This is the one genuinely dangerous thing about exporting user data.
 * 2. Excel's UTF-8 handling. Without a byte-order mark, Excel on Windows opens
 *    the file in the local codepage and every ₹, name and dash arrives mangled.
 */

const NEEDS_QUOTING = /[",\r\n]/;
const FORMULA_LEAD = /^[=+\-@\t\r]/;

export const CSV_BOM = "﻿";

export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";

  // Numbers are written bare so the spreadsheet can sum them.
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";

  const neutralised = FORMULA_LEAD.test(value) ? `'${value}` : value;
  return NEEDS_QUOTING.test(neutralised) ? `"${neutralised.replaceAll('"', '""')}"` : neutralised;
}

/** One CSV record, CRLF-terminated as the format specifies. */
export function csvRow(cells: (string | number | null | undefined)[]): string {
  return `${cells.map(csvCell).join(",")}\r\n`;
}
