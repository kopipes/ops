"use client";

import Link from "next/link";
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
      className="fixed bottom-0 left-0 right-0 z-40 border-t bg-[var(--surface)]"
      style={{ borderColor: "var(--border)", paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="mx-auto flex max-w-lg items-stretch justify-between">
        {tabs.map((t) => {
          const active = pathname === t.href || (t.href !== "/" && pathname.startsWith(t.href));
          return (
            <li key={t.href} className="flex-1">
              <Link
                href={t.href}
                aria-current={active ? "page" : undefined}
                className="flex min-h-[56px] flex-col items-center justify-center gap-1 px-1 text-[11px]"
                style={{ color: active ? "var(--accent)" : "var(--muted)" }}
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
