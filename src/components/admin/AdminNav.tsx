import Link from "next/link";

/** Shared chrome for /admin/* (§12). */
export function AdminNav({
  active,
}: {
  active: "users" | "divisions" | "settings" | "audit";
}) {
  const links = [
    { key: "users", href: "/admin/users", label: "User" },
    { key: "divisions", href: "/admin/divisions", label: "Divisi" },
    { key: "settings", href: "/admin/settings", label: "Setelan" },
    { key: "audit", href: "/admin/audit", label: "Audit" },
  ] as const;

  return (
    <nav
      aria-label="Admin"
      className="mb-4 grid grid-cols-2 gap-1 rounded-lg p-1 sm:grid-cols-4 lg:inline-grid lg:w-auto lg:grid-flow-col lg:auto-cols-max lg:grid-cols-none"
      style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
    >
      {links.map((l) => (
        <Link
          key={l.key}
          href={l.href}
          aria-current={l.key === active ? "page" : undefined}
          className="flex min-h-[40px] items-center justify-center rounded-md px-3 text-center text-sm"
          style={{
            background: l.key === active ? "var(--accent)" : "transparent",
            color: l.key === active ? "#fff" : "var(--muted)",
          }}
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
