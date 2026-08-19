"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { GovUtilityBar } from "./gov-utility-bar";

const NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: "/visit", label: "Plan Your Visit" },
  { href: "/gallery", label: "Gallery" },
  { href: "/ticket", label: "Find My Ticket" },
];

/**
 * Public-site masthead. The department strip and tricolour rule scroll away;
 * the navigation bar itself stays pinned, with the Book Tickets action always
 * visible — even with the mobile menu closed — since that's the one thing this
 * whole site exists to make easy to find.
 */
export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <>
      <GovUtilityBar />
      <div className="gov-tricolour" aria-hidden />

      <header className="sticky top-0 z-40 border-b border-zoo-cream-strong bg-zoo-forest-deep text-zoo-cream shadow-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2.5">
          <Link href="/" className="flex shrink-0 items-center gap-2.5 group">
            <Image
              src="/lion_deer_safari_logo.jpeg"
              alt="M.C.Z.P Chhatbir crest"
              width={44}
              height={44}
              className="h-9 w-9 rounded-full ring-2 ring-zoo-gold-light/70 transition-transform duration-300 group-hover:scale-105 sm:h-11 sm:w-11"
              priority
            />
            <span className="leading-tight">
              <span className="block font-display text-lg tracking-wide text-white sm:text-xl">
                Chhatbir Zoo
              </span>
              <span className="block text-[9px] uppercase tracking-[0.18em] text-zoo-gold-light sm:text-[11px] sm:tracking-[0.2em]">
                Lion &amp; Deer Safari
              </span>
            </span>
          </Link>

          <nav aria-label="Primary" className="hidden items-center gap-1 lg:flex">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                aria-current={isActive(link.href) ? "page" : undefined}
                className={`relative rounded-lg px-3 py-2 text-sm font-medium transition-colors after:absolute after:inset-x-3 after:bottom-1 after:h-[2px] after:origin-left after:scale-x-0 after:bg-zoo-gold-light after:transition-transform hover:after:scale-x-100 ${
                  isActive(link.href)
                    ? "text-zoo-gold-light after:scale-x-100"
                    : "text-zoo-cream/90 hover:text-zoo-gold-light"
                }`}
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <Link
              href="/book"
              className="whitespace-nowrap rounded-lg bg-zoo-gold-light px-3 py-2.5 text-xs font-bold text-zoo-ink transition-all hover:brightness-95 hover:shadow-md hover:shadow-black/30 sm:px-4 sm:text-sm"
            >
              Book Tickets
            </Link>
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-controls="mobile-nav"
              aria-label="Toggle menu"
              className="grid h-10 w-10 place-items-center rounded-lg border border-zoo-cream/30 text-zoo-cream transition-colors hover:border-zoo-gold-light hover:text-zoo-gold-light lg:hidden"
            >
              {open ? (
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
                </svg>
              )}
            </button>
          </div>
        </div>

        {open ? (
          <nav
            id="mobile-nav"
            aria-label="Primary"
            className="border-t border-zoo-cream/15 px-4 py-3 lg:hidden"
          >
            <ul className="space-y-1">
              {NAV_LINKS.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    onClick={() => setOpen(false)}
                    aria-current={isActive(link.href) ? "page" : undefined}
                    className={`block rounded-lg px-2 py-2.5 text-sm font-medium transition-colors hover:bg-white/5 hover:text-zoo-gold-light ${
                      isActive(link.href)
                        ? "bg-white/5 text-zoo-gold-light"
                        : "text-zoo-cream/90"
                    }`}
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
      </header>
    </>
  );
}
