export const SEVERITY_TONE: Record<string, { bg: string; fg: string }> = {
  critical: { bg: "#fecaca", fg: "#7f1d1d" },
  high: { bg: "#fee2e2", fg: "#991b1b" },
  medium: { bg: "#ffedd5", fg: "#9a3412" },
  low: { bg: "#e2e8f0", fg: "#334155" },
};

export const STATUS_TONE: Record<string, { bg: string; fg: string }> = {
  open: { bg: "#fee2e2", fg: "#991b1b" },
  in_progress: { bg: "#ffedd5", fg: "#9a3412" },
  resolved: { bg: "#dcfce7", fg: "#166534" },
  closed: { bg: "#e2e8f0", fg: "#334155" },
};

export function Pill({ label, tone }: { label: string; tone: { bg: string; fg: string } }) {
  return (
    <span
      className="inline-block rounded-full px-2 py-0.5 text-[11px] leading-4"
      style={{ background: tone.bg, color: tone.fg }}
    >
      {label}
    </span>
  );
}
