"use client";

import { NavigationLink as Link } from "@/components/NavigationLink";
import { usePathname } from "next/navigation";
import type { Tab } from "@/components/BottomNav";
import { BrandMark, Icon } from "@/components/ui/WorkspaceUI";

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
      className="nav-rail"
    >
      <div className="flex shrink-0 items-center gap-3 px-6 pb-8 pt-8">
        <BrandMark />
        <div><span className="text-[25px] font-semibold tracking-tight text-white">Ops<span className="text-[#8897bc]">.</span></span><p className="text-[9px] tracking-[0.1em] text-[#7f8eaf]">PROVALIANT GROUP</p></div>
      </div>

      <nav className="rail-scroll px-4 pb-3">
        <p className="rail-label mb-3">Workspace</p>
        <ul className="flex flex-col gap-1">
          {tabs.map((t) => {
            const active = isActive(t.href);
            return (
              <li key={t.href}>
                <Link
                  href={t.href}
                  aria-current={active ? "page" : undefined}
                  className="rail-link"
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
            <p className="rail-label mb-3 mt-8">
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
                    aria-current={l.href === "/dashboard" && isActive("/dashboard") ? "page" : undefined}
                    className="rail-secondary"
                  >
                    <span className="h-1 w-1 rounded-full bg-[#6e7d9d]" aria-hidden="true" />
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {userRole === "admin" || userRole === "manager" ? <div className="mb-2 mt-6 border-t border-white/10 pt-4"><p className="rail-label mb-2">Kelola workspace</p><Link href="/admin/users" className="rail-link" aria-current={isActive("/admin") ? "page" : undefined}><Icon name="shield" size={18} />User & aktivasi</Link><Link href="/master/checklist-items" className="rail-link" aria-current={isActive("/master") ? "page" : undefined}><Icon name="layers" size={18} />Master data</Link></div> : null}
      </nav>

      <Link
        href="/me"
        className="mx-4 mb-5 mt-3 flex shrink-0 items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3"
      >
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold"
          style={{ background: "#2c3653", color: "#c3cded" }}
          aria-hidden="true"
        >
          {userName.slice(0, 1).toUpperCase()}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-xs font-medium text-white">{userName}</span>
          <span className="mt-0.5 block truncate text-[10px] capitalize text-[#8e9dba]">
            {userRole}
          </span>
        </span>
        <span className="ml-auto text-[#8e9dba]"><Icon name="arrow" size={16} /></span>
      </Link>
    </aside>
  );
}
