import { AuthForm, Field } from "@/components/AuthForm";
import { changePasswordAction } from "@/app/auth-actions";
import { requireUser } from "@/server/auth/current-user";
import { AuthLayout } from "@/components/AuthLayout";

export const metadata = { title: "Ganti Password — Ops" };

export default async function ChangePasswordPage() {
  const session = await requireUser();

  return (
    <AuthLayout>
      <p className="eyebrow mb-3">KEAMANAN AKUN</p>
      <h1 className="mb-3 text-[30px] font-semibold tracking-[-0.04em]">Ganti Password</h1>
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
    </AuthLayout>
  );
}
