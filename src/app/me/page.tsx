import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { requireUser } from "@/server/auth/current-user";
import { logoutAction } from "@/app/auth-actions";
import { getDb } from "@/server/db";
import { divisions } from "@/server/db/schema";
import { inArray } from "drizzle-orm";
import { Icon, PageHeader } from "@/components/ui/WorkspaceUI";

export default async function AccountPage() {
  const session = await requireUser();
  const db = getDb();

  const divs =
    session.user.divisionIds.length === 0
      ? []
      : await db
          .select({ id: divisions.id, name: divisions.name, code: divisions.code })
          .from(divisions)
          .where(inArray(divisions.id, session.user.divisionIds));

  return (
    <AppShell contentWidth="form">
      <PageHeader eyebrow="YOUR PROFILE" title="Akun" description="Profil, akses workspace, dan pengaturan akun Anda." />

      <div className="surface-card mb-5 flex items-center gap-4 p-5"><span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--accent-soft)] text-lg font-semibold text-[var(--accent)]" aria-hidden="true">{session.name.split(" ").slice(0, 2).map(part => part[0]).join("").toUpperCase()}</span><div className="min-w-0"><p className="break-words text-lg font-semibold tracking-tight">{session.name}</p><span className="status-badge tone-accent mt-1 capitalize">{session.user.role}</span></div><span className="ml-auto text-[var(--muted)]"><Icon name="shield" size={24} /></span></div>

      <dl
        className="mb-6 rounded-xl border px-4 py-3 text-sm"
        style={{ borderColor: "var(--border)", background: "var(--surface)" }}
      >
        <div className="flex justify-between gap-4 py-2">
          <dt style={{ color: "var(--muted)" }}>Nama</dt>
          <dd>{session.name}</dd>
        </div>
        <div className="flex justify-between gap-4 border-t border-[var(--border)] py-2">
          <dt style={{ color: "var(--muted)" }}>Email</dt>
          <dd className="min-w-0 break-all text-right">{session.email}</dd>
        </div>
        <div className="flex justify-between gap-4 border-t border-[var(--border)] py-2">
          <dt style={{ color: "var(--muted)" }}>Role</dt>
          <dd>{session.user.role}</dd>
        </div>
        <div className="flex justify-between gap-4 border-t border-[var(--border)] py-2">
          <dt className="shrink-0" style={{ color: "var(--muted)" }}>
            Divisi
          </dt>
          <dd className="text-right">{divs.map((d) => d.name).join(", ")}</dd>
        </div>
      </dl>

      {session.user.role === "admin" || session.user.role === "manager" ? (
        <Link
          href="/admin/users"
          className="mb-3 flex min-h-tap items-center justify-center rounded-lg border px-4 py-3 text-base"
          style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--fg)" }}
        >
          {session.user.role === "admin" ? "Admin: user, divisi, setelan, audit" : "User & aktivasi crew"}
        </Link>
      ) : null}

      {session.user.role === "admin" || session.user.role === "manager" ? (
        <Link
          href="/master/checklist-items"
          className="mb-3 flex min-h-tap items-center justify-center rounded-lg border px-4 py-3 text-base"
          style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--fg)" }}
        >
          Master data & template
        </Link>
      ) : null}

      <Link
        href="/me/password"
        className="mb-3 flex min-h-tap items-center justify-center rounded-lg border px-4 py-3 text-base"
        style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--fg)" }}
      >
        Ganti password
      </Link>

      <form action={logoutAction}>
        <button
          type="submit"
          className="min-h-tap w-full rounded-lg border px-4 py-3 text-base"
          style={{ borderColor: "var(--border)", color: "var(--status-notok, #dc2626)" }}
        >
          Keluar
        </button>
      </form>
    </AppShell>
  );
}
