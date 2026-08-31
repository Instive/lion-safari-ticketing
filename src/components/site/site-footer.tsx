import Image from "next/image";
import Link from "next/link";

import { supportPhone } from "@/lib/env";

export function SiteFooter() {
  // `supportPhone()` rather than `env.SUPPORT_PHONE`: this footer wraps the
  // statically prerendered customer pages, and reading the validated env here
  // would demand production secrets during `next build` (see lib/env.ts).
  const support = supportPhone();

  return (
    <footer className="border-t border-zoo-cream-strong bg-zoo-forest-deep text-zoo-cream">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <div className="flex items-center gap-2.5">
            <Image
              src="/lion_deer_safari_logo.jpeg"
              alt="M.C.Z.P Chhatbir crest"
              width={40}
              height={40}
              className="rounded-full ring-2 ring-zoo-gold-light/70"
            />
            <span className="font-display text-lg tracking-wide text-white">Chhatbir Zoo</span>
          </div>
          <p className="mt-3 text-sm text-zoo-cream/70">
            Explore. Observe. Preserve. A journey into the heart of wildlife at Mahendra
            Choudhary Zoological Park.
          </p>
          <div className="mt-4 flex gap-3">
            <SocialIcon label="Instagram">
              <rect x="3" y="3" width="18" height="18" rx="5" />
              <circle cx="12" cy="12" r="4" />
              <circle cx="17.2" cy="6.8" r="0.6" fill="currentColor" stroke="none" />
            </SocialIcon>
            <SocialIcon label="Facebook">
              <path d="M14 9h2V6h-2c-1.7 0-3 1.3-3 3v2H9v3h2v6h3v-6h2.2l.8-3H14V9z" />
            </SocialIcon>
            <SocialIcon label="Location">
              <path d="M12 21s-6.5-5.2-6.5-10.5A6.5 6.5 0 0 1 12 4a6.5 6.5 0 0 1 6.5 6.5C18.5 15.8 12 21 12 21z" />
              <circle cx="12" cy="10.5" r="2.2" />
            </SocialIcon>
          </div>
        </div>

        <div>
          <h3 className="text-xs font-semibold uppercase tracking-[0.15em] text-zoo-gold-light">
            Visit
          </h3>
          <ul className="mt-3 space-y-2 text-sm text-zoo-cream/80">
            <li>
              <Link href="/visit" className="hover:text-zoo-gold-light">
                Timings &amp; Rules
              </Link>
            </li>
            <li>
              <Link href="/visit#reach" className="hover:text-zoo-gold-light">
                How to Reach
              </Link>
            </li>
            <li>
              <Link href="/gallery" className="hover:text-zoo-gold-light">
                Gallery
              </Link>
            </li>
            <li>
              <Link href="/book" className="hover:text-zoo-gold-light">
                Book Tickets
              </Link>
            </li>
            <li>
              <Link href="/ticket" className="hover:text-zoo-gold-light">
                Find My Ticket
              </Link>
            </li>
          </ul>
        </div>

        <div>
          <h3 className="text-xs font-semibold uppercase tracking-[0.15em] text-zoo-gold-light">
            Timings
          </h3>
          <ul className="mt-3 space-y-2 text-sm text-zoo-cream/80">
            <li>Tuesday – Sunday: 9:00 AM – 5:00 PM</li>
            <li>Closed Mondays</li>
            <li className="pt-1 text-zoo-cream/60">
              Last entry one hour before closing.
            </li>
          </ul>
        </div>

        <div>
          <h3 className="text-xs font-semibold uppercase tracking-[0.15em] text-zoo-gold-light">
            Location
          </h3>
          <p className="mt-3 text-sm text-zoo-cream/80">
            Chhat Village, Zirakpur–Patiala Highway,
            <br />
            Punjab — approx. 17 km from Chandigarh
          </p>
          {support ? (
            <p className="mt-3 text-sm text-zoo-cream/80">
              Support: <span className="text-zoo-gold-light">{support}</span>
            </p>
          ) : null}
        </div>
      </div>

      <div className="border-t border-zoo-cream/10 px-4 py-4 text-center text-xs text-zoo-cream/50">
        Protect Wildlife. Preserve Nature. — M.C.Z.P Chhatbir
      </div>
    </footer>
  );
}

function SocialIcon({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span
      aria-label={label}
      className="grid h-9 w-9 place-items-center rounded-full border border-zoo-cream/25 text-zoo-cream/80"
    >
      <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.6">
        {children}
      </svg>
    </span>
  );
}
