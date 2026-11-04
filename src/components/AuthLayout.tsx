import type { ReactNode } from "react";
import { BrandMark, Icon } from "@/components/ui/WorkspaceUI";

export function AuthLayout({ children }: { children: ReactNode }) {
  return <div className="auth-layout">
    <aside className="auth-story">
      <div className="flex items-center gap-3"><BrandMark /><span className="text-2xl font-semibold tracking-tight">Pulse<span className="ml-3 border-l border-white/20 pl-3 text-xs font-normal tracking-wide text-slate-400">PROVALIANT GROUP</span></span></div>
      <div className="auth-story-content">
        <p className="eyebrow !text-indigo-300">YOUR OPERATIONS, CONNECTED</p>
        <h2>Setiap detail.<br />Satu kendali.</h2>
        <p className="auth-story-description">Dari opening hingga closing, pastikan setiap project berjalan dengan baik. Satu tempat untuk tim, laporan, dan tindak lanjut.</p>
        <div className="auth-illustration" aria-hidden="true">
          <div className="flex items-center justify-between border-b border-white/10 pb-5"><div className="flex items-center gap-3"><span className="rounded-xl bg-indigo-400/15 p-2.5 text-indigo-300"><Icon name="layers" /></span><div><p className="text-sm font-medium text-white">Daily operations</p><p className="mt-1 text-[11px] text-slate-400">Opening · Monitoring · Closing</p></div></div><span className="rounded-full border border-white/15 px-2 py-1 text-[10px] text-slate-300">WORKSPACE</span></div>
          <div className="mt-5 flex items-center gap-3"><span className="illustration-check"><Icon name="check" size={15} /></span><span className="text-sm text-slate-200">Checklist terdokumentasi</span><span className="ml-auto text-[11px] text-indigo-300">01</span></div>
          <div className="mt-4 flex items-center gap-3"><span className="illustration-check"><Icon name="check" size={15} /></span><span className="text-sm text-slate-200">Laporan mudah ditelusuri</span><span className="ml-auto text-[11px] text-indigo-300">02</span></div>
          <div className="mt-4 flex items-center gap-3"><span className="illustration-check"><Icon name="check" size={15} /></span><span className="text-sm text-slate-200">Tindak lanjut lebih terarah</span><span className="ml-auto text-[11px] text-indigo-300">03</span></div>
        </div>
      </div>
      <p className="flex items-center gap-2 text-xs text-slate-400"><Icon name="shield" size={15} /> Ruang kerja internal Provaliant Group</p>
    </aside>
    <main className="auth-content"><div className="auth-form-wrap"><div className="mb-9 flex items-center gap-3 lg:hidden"><BrandMark /><span className="text-xl font-semibold tracking-tight">Pulse<span className="ml-2 text-xs font-normal text-[var(--muted)]">Provaliant Group</span></span></div>{children}<p className="auth-footer">Pulse · Provaliant Group</p></div></main>
  </div>;
}
