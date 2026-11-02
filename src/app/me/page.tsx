import { AppShell } from "@/components/AppShell";
import { requireUser } from "@/server/auth/current-user";
import { logoutAction } from "@/app/auth-actions";
import { getDb } from "@/server/db";
import { divisions } from "@/server/db/schema";
import { inArray } from "drizzle-orm";

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
    <AppShell>
      <h1 className="mb-4 text-xl font-semibold">Akun</h1>

      <dl
        className="mb-6 rounded-xl border px-4 py-3 text-sm"
        style={{ borderColor: "var(--border)", background: "var(--surface)" }}
      >
        <div className="flex justify-between py-1">
          <dt style={{ color: "var(--muted)" }}>Nama</dt>
          <dd>{session.name}</dd>
        </div>
        <div className="flex justify-between py-1">
          <dt style={{ color: "var(--muted)" }}>Email</dt>
          <dd>{session.email}</dd>
        </div>
        <div className="flex justify-between py-1">
          <dt style={{ color: "var(--muted)" }}>Role</dt>
          <dd>{session.user.role}</dd>
        </div>
        <div className="flex justify-between gap-4 py-1">
          <dt className="shrink-0" style={{ color: "var(--muted)" }}>
            Divisi
          </dt>
          <dd className="text-right">{divs.map((d) => d.name).join(", ")}</dd>
        </div>
      </dl>

      {session.user.role === "admin" ? (
        <a
          href="/admin/users"
          className="mb-3 flex min-h-tap items-center justify-center rounded-lg border px-4 py-3 text-base"
          style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--fg)" }}
        >
          Admin: user, divisi, setelan, audit
        </a>
      ) : null}

      {session.user.role === "admin" || session.user.role === "manager" ? (
        <a
          href="/master/checklist-items"
          className="mb-3 flex min-h-tap items-center justify-center rounded-lg border px-4 py-3 text-base"
          style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--fg)" }}
        >
          Master data & template
        </a>
      ) : null}

      <a
        href="/me/password"
        className="mb-3 flex min-h-tap items-center justify-center rounded-lg border px-4 py-3 text-base"
        style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--fg)" }}
      >
        Ganti password
      </a>

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
