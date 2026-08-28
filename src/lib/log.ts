/**
 * A shared shape for lines meant to be read from Render's log stream.
 *
 * Render captures stdout/stderr verbatim with no structured-field support of
 * its own — a raw `console.error(err)` prints a multi-line, unlabelled blob
 * that is hard to find again once the stream has moved on. Every call here
 * instead produces exactly one `[scope] message key=value ...` line, with any
 * stack trace printed as a clearly separate follow-up line, so a failure can
 * be found by scope, skimmed in one line, and still has its trace right below
 * it when a human needs to read further.
 *
 * This does not replace the `console.*` calls already scattered through the
 * app — most already read fine as one-off lines. It exists for the place that
 * had no logging at all: a background job's handler throwing is caught
 * internally by pg-boss and recorded only in the `pgboss.job` table (see
 * `worker.ts`), so a ticket email or the nightly report failing every retry
 * was previously invisible outside a manual database query.
 */
type Fields = Record<string, unknown>;

function formatFields(fields?: Fields): string {
  if (!fields) return "";
  const parts = Object.entries(fields).map(([key, value]) => {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    // Quoted whenever it contains whitespace, so the field still reads as one
    // token when the line is skimmed or grepped.
    return /\s/.test(text) ? `${key}="${text}"` : `${key}=${text}`;
  });
  return parts.length ? " " + parts.join(" ") : "";
}

function line(scope: string, message: string, fields?: Fields): string {
  return `[${scope}] ${message}${formatFields(fields)}`;
}

export const log = {
  info(scope: string, message: string, fields?: Fields): void {
    console.log(line(scope, message, fields));
  },

  warn(scope: string, message: string, fields?: Fields): void {
    console.warn(line(scope, message, fields));
  },

  /**
   * `err`'s message is folded into the summary line so the failure is
   * greppable on its own; the stack trace prints as a separate line right
   * after it — still captured by Render, just kept out of the single-line
   * summary so a dashboard skim isn't three lines of stack per event.
   */
  error(scope: string, message: string, err?: unknown, fields?: Fields): void {
    const errorMessage =
      err instanceof Error ? err.message : err !== undefined ? String(err) : undefined;
    console.error(
      line(scope, message, {
        ...(errorMessage !== undefined ? { error: errorMessage } : {}),
        ...fields,
      }),
    );
    if (err instanceof Error && err.stack) console.error(err.stack);
  },
};
