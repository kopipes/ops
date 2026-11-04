import { redirect } from "next/navigation";
import Link from "next/link";
import { AuthForm, Field } from "@/components/AuthForm";
import { loginAction } from "@/app/auth-actions";
import { currentSession } from "@/server/auth/current-user";
import { AuthLayout } from "@/components/AuthLayout";

export const metadata = { title: "Masuk — Pulse" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ changed?: string; registered?: string }>;
}) {
  const session = await currentSession();
  if (session) redirect("/");

  const { changed, registered } = await searchParams;

  return (
    <AuthLayout>
      <div className="mb-8">
        <p className="eyebrow mb-3">SELAMAT DATANG DI PULSE</p>
        <h1 className="text-[32px] font-semibold tracking-[-0.04em]">Siap untuk hari ini?</h1>
        <p className="mt-3 text-sm leading-6 text-[var(--muted)]">Masuk untuk memantau project dan melanjutkan pekerjaan bersama tim Anda.</p>
      </div>

      {changed ? (
        <p
          role="status"
          className="mb-4 rounded-lg border px-3 py-2 text-sm"
          style={{ borderColor: "var(--border)", color: "var(--muted)" }}
        >
          Password berhasil diubah. Silakan masuk kembali.
        </p>
      ) : null}
      {registered ? <p role="status" className="mb-4 rounded-lg border px-3 py-3 text-sm" style={{ borderColor: "var(--border)", color: "var(--fg)" }}>Permintaan pendaftaran diterima. Akun baru belum aktif. Hubungi Admin atau Manager divisi Anda untuk aktivasi sebelum masuk.</p> : null}

      <AuthForm action={loginAction} submitLabel="Masuk">
        <Field label="Email" name="email" type="email" autoComplete="username" inputMode="email" />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
        />
      </AuthForm>

      <p className="mt-6 text-center text-xs" style={{ color: "var(--muted)" }}>Belum punya akun? <Link href="/register" className="font-semibold" style={{ color: "var(--accent)" }}>Daftar</Link></p>

      <p className="mt-6 text-center text-xs" style={{ color: "var(--muted)" }}>
        Lupa password? Hubungi Admin untuk reset.
      </p>
    </AuthLayout>
  );
}
