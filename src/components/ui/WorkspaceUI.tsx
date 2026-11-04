import type { ReactNode } from "react";

const paths = {
  arrow: "M5 12h14m-6-6 6 6-6 6",
  folder: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  check: "m5 12 4 4L19 6",
  clock: "M12 8v4l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
  calendar: "M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2",
  pin: "M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0ZM15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
  alert: "M12 9v4m0 4h.01M10.3 3.9 2.4 17.6A2 2 0 0 0 4.1 20.6h15.8a2 2 0 0 0 1.7-3z",
  layers: "m12 3 10 5-10 5L2 8l10-5ZM2 12l10 5 10-5M2 16l10 5 10-5",
  search: "m21 21-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
  plus: "M12 5v14M5 12h14",
  shield: "M12 3 3 7v6c0 5 9 9 9 9s9-4 9-9V7l-9-4Zm-4 9 3 3 5-5",
} as const;

export function Icon({ name, size = 20, className = "" }: { name: keyof typeof paths; size?: number; className?: string }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 ${className}`}><path d={paths[name]} /></svg>;
}

export function BrandMark({ className = "" }: { className?: string }) {
  return <span className={`brand-mark ${className}`} aria-hidden="true"><svg width="25" height="25" viewBox="0 0 28 28" fill="none"><path d="m14 3 10 5.5v11L14 25 4 19.5v-11L14 3Z" stroke="currentColor" strokeWidth="2" /><path d="m9 14 3.5 3.5L19 10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg></span>;
}

export function PageHeader({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: ReactNode }) {
  return <header className="page-heading"><div className="w-full min-w-0">{eyebrow ? <p className="eyebrow mb-2">{eyebrow}</p> : null}<div className="flex flex-wrap items-center justify-between gap-3"><h1>{title}</h1>{action ? <div className="page-heading-action">{action}</div> : null}</div>{description ? <p className="page-description">{description}</p> : null}</div></header>;
}

export function MetricCard({ label, value, hint, icon, tone = "accent" }: { label: string; value: string | number; hint?: string; icon: keyof typeof paths; tone?: "accent" | "success" | "warning" | "neutral" }) {
  const tones = {accent: "tone-accent", success: "tone-success", warning: "tone-warning", neutral: "tone-neutral"};
  return <div className="metric-card"><div className="flex items-center justify-between gap-3"><p className="metric-label">{label}</p><span className={`metric-icon ${tones[tone]}`}><Icon name={icon} size={18} /></span></div><p className="metric-value">{value}</p>{hint ? <p className="metric-hint">{hint}</p> : null}</div>;
}
