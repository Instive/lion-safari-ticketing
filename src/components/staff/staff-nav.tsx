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
    <nav className="flex gap-1 text-sm">
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-lg px-2.5 py-1.5 transition-colors ${
              active
                ? "bg-background font-semibold text-foreground"
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
