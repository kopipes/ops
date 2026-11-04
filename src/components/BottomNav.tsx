"use client";

import { NavigationLink as Link } from "@/components/NavigationLink";
import { usePathname } from "next/navigation";

export interface Tab {
  href: string;
  label: string;
  /** Inline SVG path data — no icon dependency for a handful of icons. */
  icon: string;
}

/** §12: bottom tab bar — Hari Ini · Project · Issues · Report (if permitted) · Akun */
export function BottomNav({ tabs }: { tabs: Tab[] }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Navigasi utama"
      className="bottom-nav"
    >
      <ul className="mx-auto flex max-w-lg items-stretch justify-between">
        {tabs.map((t) => {
          const active = pathname === t.href || (t.href !== "/" && pathname.startsWith(t.href));
          return (
            <li key={t.href} className="flex-1">
              <Link
                href={t.href}
                aria-current={active ? "page" : undefined}
                className="bottom-nav-link"
              >
                <svg
                  aria-hidden="true"
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d={t.icon} />
                </svg>
                <span>{t.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
