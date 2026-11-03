import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthForm, Field } from "@/components/AuthForm";
import { registerAction } from "@/app/auth-actions";
import { currentSession } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { listActiveDivisions } from "@/server/services/admin";

export const metadata = { title: "Daftar — Ops" };

export default async function RegisterPage() {
  if (await currentSession()) redirect("/");
  const divisions = await listActiveDivisions(getDb());
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-10">
      <Link href="/login" className="mb-5 text-sm" style={{ color: "var(--accent)" }}>← Kembali ke login</Link>
      <h1 className="text-2xl font-semibold">Daftar akun Ops</h1>
      <p className="mb-6 mt-2 text-sm" style={{ color: "var(--muted)" }}>Akun baru terdaftar sebagai User (Crew) dan belum aktif. Admin atau Manager divisi Anda perlu mengaktifkannya sebelum Anda bisa masuk.</p>
      {divisions.length ? <AuthForm action={registerAction} submitLabel="Daftar">
        <Field label="Nama lengkap" name="name" autoComplete="name" minLength={2} maxLength={120} />
        <Field label="Email" name="email" type="email" autoComplete="username" inputMode="email" maxLength={254} />
        <Field label="Telepon (opsional)" name="phone" type="tel" autoComplete="tel" required={false} maxLength={30} />
        <label className="flex flex-col gap-1 text-sm">
          <span style={{ color: "var(--muted)" }}>Divisi</span>
          <select name="primaryDivisionId" required defaultValue="" className="min-h-tap rounded-lg border px-3 py-3 text-base" style={{ background: "var(--surface)", color: "var(--fg)", borderColor: "var(--border)" }}>
            <option value="" disabled>Pilih divisi Anda</option>
            {divisions.map(division => <option key={division.id} value={division.id}>{division.name}</option>)}
          </select>
        </label>
        <Field label="Password (min. 8 karakter)" name="password" type="password" autoComplete="new-password" minLength={8} maxLength={128} />
        <Field label="Konfirmasi password" name="confirmPassword" type="password" autoComplete="new-password" minLength={8} maxLength={128} />
      </AuthForm> : <p role="status" className="text-sm">Divisi belum tersedia. Hubungi Admin untuk mendaftar.</p>}
    </main>
  );
}
