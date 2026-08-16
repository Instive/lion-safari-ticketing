import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { customAlphabet } from "nanoid";

/**
 * Booking codes are read aloud over the phone and typed by staff, so the
 * alphabet excludes characters that are easily confused (0/O, 1/I/L, 5/S, 8/B).
 * The code is a customer-facing reference only — it is never an authorization
 * credential, which is why a shorter, human-friendly code is safe here.
 */
const bookingAlphabet = "ACDEFGHJKMNPQRTUVWXY2346789";
const bookingSuffix = customAlphabet(bookingAlphabet, 8);

export function generateBookingCode(): string {
  return `LS${bookingSuffix()}`;
}

/**
 * The ticket token IS the authorization credential carried in the QR, so it is
 * 256 bits of CSPRNG output — never a sequence, never derived from a row id.
 */
export function generateTicketToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Device API keys, shown once at registration and stored only as a hash. */
export function generateApiKey(): string {
  return randomBytes(32).toString("base64url");
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Constant-time comparison for secrets (session tokens, API keys, signatures). */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
