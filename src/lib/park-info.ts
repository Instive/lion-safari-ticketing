/**
 * The park's visitor-facing facts, in one place.
 *
 * These same lines appear in the site footer, the visitor guide and now the
 * ticket email. They were previously hardcoded in each, which is how the
 * closing time ends up saying one thing on the website and another on a
 * ticket a guest is holding at the gate. Anything a guest could read in two
 * places belongs here.
 *
 * Safe to import from Client Components: plain data, no `@/lib/env`.
 */

export const PARK_TIMINGS = {
  open: "Tuesday – Sunday, 9:00 AM – 5:00 PM",
  closed: "Closed every Monday",
  lastEntry: "Last entry one hour before closing",
} as const;

export const PARK_ADDRESS = {
  lines: ["Chhat Village, Zirakpur–Patiala Highway (NH-7)", "Punjab — approx. 17 km from Chandigarh"],
} as const;

/**
 * Rules a guest should know before arriving. Kept to the ones that change
 * what someone does on the day — the full list lives on /visit.
 */
export const PARK_RULES = [
  "Stay seated inside the safari vehicle at all times — do not lean or reach out.",
  "Do not feed, tease or make loud noises at the animals.",
  "Flash photography is not permitted near the enclosures.",
  "Follow the instructions of safari and gate staff at all times.",
  "No plastic bags, smoking or alcohol inside the park.",
  "Children must be accompanied by an adult throughout the visit.",
] as const;

/** Under this age, a child does not need a ticket. */
export const FREE_ENTRY_UNDER_AGE = 3;

export const FREE_ENTRY_NOTE = `Children under ${FREE_ENTRY_UNDER_AGE} enter free and do not need a ticket.`;

export const PARK_TAGLINE = "Protect Wildlife. Preserve Nature. — M.C.Z.P Chhatbir";
