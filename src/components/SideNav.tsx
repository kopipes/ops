"use client";

import { NavigationLink as Link } from "@/components/NavigationLink";
import { usePathname } from "next/navigation";
import type { Tab } from "@/components/BottomNav";

/**
 * Desktop navigation (§12). Hidden below `lg`, where BottomNav takes over.
 * Rendered as a fixed rail so the content column can scroll independently.
 */
export function SideNav({
  tabs,
  userName,
  userRole,
  canSeeReports,
}: {
  tabs: Tab[];
  userName: string;
  userRole: string;
  canSeeReports: boolean;
}) {
  const pathname = usePathname();

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <aside
      aria-label="Navigasi utama"
      className="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:z-40 lg:flex lg:w-60 lg:flex-col lg:border-r"
      style={{ borderColor: "var(--border)", background: "var(--surface)" }}
    >
      <div className="flex items-center gap-2 px-5 py-5">
        <span
          className="flex h-9 w-9 items-center justify-center rounded-xl text-base font-bold text-white"
          style={{ background: "var(--accent)" }}
          aria-hidden="true"
        >
          O
        </span>
        <span className="text-lg font-semibold">Ops</span>
      </div>

      <nav className="flex-1 overflow-y-auto px-3">
        <ul className="flex flex-col gap-1">
          {tabs.map((t) => {
            const active = isActive(t.href);
            return (
              <li key={t.href}>
                <Link
                  href={t.href}
                  aria-current={active ? "page" : undefined}
                  className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium"
                  style={{
                    background: active ? "var(--accent)" : "transparent",
                    color: active ? "#fff" : "var(--fg)",
                  }}
                >
                  <svg
                    aria-hidden="true"
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ opacity: active ? 1 : 0.75 }}
                  >
                    <path d={t.icon} />
                  </svg>
                  <span>{t.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>

        {/* §12: report-only shortcuts for review roles. */}
        {canSeeReports ? (
          <div className="mt-6">
            <p
              className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide"
              style={{ color: "var(--muted)" }}
            >
              Review
            </p>
            <ul className="flex flex-col gap-1">
              {[
                { href: "/dashboard", label: "Dashboard" },
                { href: "/reports?status=unreviewed", label: "Belum direview" },
                { href: "/reports?status=critical", label: "Issue High/Critical" },
              ].map((l) => (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    className="block rounded-lg px-3 py-2 text-sm"
                    style={{ color: "var(--muted)" }}
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </nav>

      {userRole === "admin" || userRole === "manager" ? <Link href="/admin/users" className="mx-3 mb-2 flex min-h-tap items-center rounded-lg px-3 text-sm font-medium" style={{ background: isActive("/admin/users") ? "var(--accent)" : "var(--bg)", color: isActive("/admin/users") ? "#fff" : "var(--fg)" }}>User & aktivasi</Link> : null}

      <Link
        href="/me"
        className="mx-3 mb-4 mt-2 flex items-center gap-3 rounded-lg px-3 py-2.5"
        style={{ background: "var(--bg)" }}
      >
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold"
          style={{ background: "var(--border)", color: "var(--fg)" }}
          aria-hidden="true"
        >
          {userName.slice(0, 1).toUpperCase()}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">{userName}</span>
          <span className="block truncate text-xs capitalize" style={{ color: "var(--muted)" }}>
            {userRole}
          </span>
        </span>
      </Link>
    </aside>
  );
}
