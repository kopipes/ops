import Link from "next/link";

/** Shared chrome for the /master/* admin surfaces (§12). */
export function MasterNav({
  active,
  isAdmin = false,
}: {
  active: "items" | "templates" | "issue-categories" | "checklist-categories";
  isAdmin?: boolean;
}) {
  const links = [
    { key: "items", href: "/master/checklist-items", label: "Checklist" },
    { key: "checklist-categories", href: "/master/checklist-categories", label: "Kategori", adminOnly: true },
    { key: "templates", href: "/master/templates", label: "Template" },
    { key: "issue-categories", href: "/master/issue-categories", label: "Kategori Issue", adminOnly: true },
  ] as const;

  const visible = links.filter((l) => !("adminOnly" in l) || !l.adminOnly || isAdmin);

  return (
    <nav
      aria-label="Master data"
      className="mb-4 grid grid-cols-2 gap-1 rounded-lg p-1 sm:grid-cols-4 lg:inline-grid lg:w-auto lg:grid-flow-col lg:auto-cols-max lg:grid-cols-none"
      style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
    >
      {visible.map((l) => {
        const isActive = l.key === active;
        return (
          <Link
            key={l.key}
            href={l.href}
            aria-current={isActive ? "page" : undefined}
            className="flex min-h-[40px] items-center justify-center rounded-md px-3 text-center text-sm"
            style={{
              background: isActive ? "var(--accent)" : "transparent",
              color: isActive ? "#fff" : "var(--muted)",
            }}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="rounded-xl border px-4 py-6 text-center text-sm"
      style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--muted)" }}
    >
      {children}
    </p>
  );
}

export function Card({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="rounded-xl border px-4 py-3"
      style={{ borderColor: "var(--border)", background: "var(--surface)" }}
    >
      {children}
    </div>
  );
}

export function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "ok" | "warn" }) {
  const colors = {
    neutral: { bg: "var(--border)", fg: "var(--fg)" },
    ok: { bg: "#dcfce7", fg: "#166534" },
    warn: { bg: "#ffedd5", fg: "#9a3412" },
  } as const;
  const c = colors[tone];
  return (
    <span
      className="inline-block rounded-full px-2 py-0.5 text-[11px] leading-4"
      style={{ background: c.bg, color: c.fg }}
    >
      {children}
    </span>
  );
}
