const COLORS: Record<string, string> = {
  questionable: "border-amber-400/40 bg-amber-400/10 text-amber-200",
  doubtful: "border-orange-400/40 bg-orange-400/10 text-orange-200",
  out: "border-rose-400/40 bg-rose-400/10 text-rose-200",
  ir: "border-rose-400/40 bg-rose-400/10 text-rose-200",
  pup: "border-rose-400/40 bg-rose-400/10 text-rose-200",
  suspended: "border-rose-400/40 bg-rose-400/10 text-rose-200",
  inactive: "border-rose-400/40 bg-rose-400/10 text-rose-200",
  nfi: "border-rose-400/40 bg-rose-400/10 text-rose-200",
};

export function InjuryBadge({ status, label, stale = false }: { status?: string | null; label?: string | null; stale?: boolean }) {
  if (!status || ["healthy", "unknown"].includes(status)) return null;
  return <span title={stale ? "Injury status is stale and is not reducing projections" : undefined} className={`inline-flex rounded border px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wide ${COLORS[status] ?? COLORS.questionable}`}>
    {label ?? status}{stale ? " · stale" : ""}
  </span>;
}
