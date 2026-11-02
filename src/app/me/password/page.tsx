import { AuthForm, Field } from "@/components/AuthForm";
import { changePasswordAction } from "@/app/auth-actions";
import { requireUser } from "@/server/auth/current-user";

export const metadata = { title: "Ganti Password — Ops" };

export default async function ChangePasswordPage() {
  const session = await requireUser();

  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-5">
      <h1 className="mb-1 text-xl font-semibold">Ganti Password</h1>
      <p className="mb-6 text-sm" style={{ color: "var(--muted)" }}>
        {session.mustChangePassword
          ? "Password kamu baru direset oleh Admin. Buat password baru untuk melanjutkan."
          : "Setelah password diubah, semua perangkat harus masuk kembali."}
      </p>

      <AuthForm action={changePasswordAction} submitLabel="Simpan password baru">
        <Field
          label="Password saat ini"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
        />
        <Field
          label="Password baru (min. 8 karakter)"
          name="newPassword"
          type="password"
          autoComplete="new-password"
        />
        <Field
          label="Ulangi password baru"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
        />
      </AuthForm>
    </div>
  );
}
