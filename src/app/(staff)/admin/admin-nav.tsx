"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const SECTIONS = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/bookings", label: "Bookings" },
  { href: "/admin/rates", label: "Rates" },
  { href: "/admin/books", label: "Ticket books" },
  { href: "/admin/enquiries", label: "Group enquiries" },
  { href: "/admin/reconciliation", label: "Reconciliation" },
  { href: "/admin/devices", label: "Devices" },
  { href: "/admin/staff", label: "Staff" },
];

export function AdminNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <aside className="no-print order-first px-4 pt-4 lg:order-last lg:pl-0 lg:pr-4 lg:pt-6">
      <nav aria-label="Admin sections" className="rounded-xl border border-line bg-surface p-2 lg:sticky lg:top-4">
        <button
          type="button"
          aria-expanded={open}
          aria-controls="admin-section-links"
          onClick={() => setOpen((value) => !value)}
          className="flex min-h-11 w-full items-center justify-between rounded-lg px-3 text-sm font-semibold lg:hidden"
        >
          <span>Admin menu</span>
          <span aria-hidden="true">{open ? "−" : "+"}</span>
        </button>
        <div id="admin-section-links" className={`${open ? "flex" : "hidden"} flex-col gap-1 lg:flex`}>
          {SECTIONS.map((section) => {
            const active =
              pathname === section.href ||
              (section.href !== "/admin" && pathname.startsWith(`${section.href}/`));
            return (
              <Link
                key={section.href}
                href={section.href}
                aria-current={active ? "page" : undefined}
                onClick={() => setOpen(false)}
                className={`rounded-lg px-3 py-2 text-sm transition-colors ${
                  active
                    ? "bg-brand font-semibold text-white"
                    : "text-muted hover:bg-background hover:text-foreground"
                }`}
              >
                {section.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </aside>
  );
}
