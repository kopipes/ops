import { redirect } from "next/navigation";
import Link from "next/link";
import { AuthForm, Field } from "@/components/AuthForm";
import { loginAction } from "@/app/auth-actions";
import { currentSession } from "@/server/auth/current-user";

export const metadata = { title: "Masuk — Ops" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ changed?: string; registered?: string }>;
}) {
  const session = await currentSession();
  if (session) redirect("/");

  const { changed, registered } = await searchParams;

  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-5">
      <div className="mb-8 text-center">
        <div
          className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl text-2xl font-bold text-white"
          style={{ background: "var(--accent)" }}
          aria-hidden="true"
        >
          O
        </div>
        <h1 className="text-2xl font-semibold">Ops</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
          Pemantauan event harian
        </p>
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

      <p className="mt-5 text-center text-sm" style={{ color: "var(--muted)" }}>Belum punya akun? <Link href="/register" className="font-medium underline underline-offset-2" style={{ color: "var(--accent)" }}>Daftar</Link></p>

      <p className="mt-6 text-center text-xs" style={{ color: "var(--muted)" }}>
        Lupa password? Hubungi Admin untuk reset.
      </p>
    </div>
  );
}
