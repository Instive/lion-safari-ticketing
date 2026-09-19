"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The staff header's section links, with the current one marked.
 *
 * Admins move between Admin and Counter all shift and the two screens open on
 * different-looking content, so which one you are on was only ever inferable
 * from the page itself. `aria-current` carries the same fact to a screen
 * reader.
 */
export function StaffNav({ items }: { items: { href: string; label: string }[] }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Staff workspace" className="flex flex-wrap gap-1 text-sm">
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`inline-flex min-h-11 items-center rounded-lg px-3 py-2 transition-colors ${
              active
                ? "bg-brand font-semibold text-white"
                : "text-muted hover:text-foreground"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
