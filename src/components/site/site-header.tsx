"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

const NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: "/visit", label: "Plan Your Visit" },
  { href: "/gallery", label: "Gallery" },
  { href: "/ticket", label: "Find My Ticket" },
];

/**
 * Public-site header. Sticky, with the Book Tickets action always visible —
 * even with the mobile menu closed — since that's the one thing this whole
 * site exists to make easy to find.
 */
export function SiteHeader() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-zoo-cream-strong bg-zoo-forest-deep text-zoo-cream">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2.5">
        <Link href="/" className="flex items-center gap-2.5 shrink-0">
          <Image
            src="/lion_deer_safari_logo.jpeg"
            alt="M.C.Z.P Chhatbir crest"
            width={44}
            height={44}
            className="rounded-full ring-2 ring-zoo-gold-light/70"
            priority
          />
          <span className="leading-tight">
            <span className="block font-display text-xl tracking-wide text-white">
              Chhatbir Zoo
            </span>
            <span className="block text-[11px] uppercase tracking-[0.2em] text-zoo-gold-light">
              Lion &amp; Deer Safari
            </span>
          </span>
        </Link>

        <nav className="hidden items-center gap-6 lg:flex">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm font-medium text-zoo-cream/90 transition-colors hover:text-zoo-gold-light"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <Link
            href="/book"
            className="rounded-lg bg-zoo-gold-light px-4 py-2.5 text-sm font-bold text-zoo-ink transition-colors hover:brightness-95"
          >
            Book Tickets
          </Link>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label="Toggle menu"
            className="grid h-10 w-10 place-items-center rounded-lg border border-zoo-cream/30 text-zoo-cream lg:hidden"
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
        <nav className="border-t border-zoo-cream/15 px-4 py-3 lg:hidden">
          <ul className="space-y-1">
            {NAV_LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className="block rounded-lg px-2 py-2.5 text-sm font-medium text-zoo-cream/90 hover:bg-white/5 hover:text-zoo-gold-light"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
    </header>
  );
}
