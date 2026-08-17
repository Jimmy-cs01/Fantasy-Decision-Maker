import { BarChart3 } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { CombinedPlayerValue, PlayerValueResult } from "@/lib/player-values/types";

export function PlayerValueCard({ value, leagueName }: { value: CombinedPlayerValue; leagueName?: string }) {
  const preferred = value.league ?? value.general;
  return <Card className="mt-5 border-violet-400/20 bg-violet-400/[0.04]">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.16em] text-violet-300"><BarChart3 size={15} /> Player Value</p><div className="mt-2 flex items-end gap-2"><span className="text-4xl font-black">{preferred.value.toFixed(1)}</span><span className="pb-1 text-sm font-semibold text-slate-400">/ 100</span></div><p className="mt-1 text-sm font-bold text-slate-200">{preferred.tier}</p></div>
      <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4"><ValueMetric label="Position" value={`${preferred.position}${preferred.positionRank}`} /><ValueMetric label="Overall" value={`#${preferred.overallRank}`} /><ValueMetric label="Replacement" value={`${preferred.replacementPpg.toFixed(1)} PPG`} /><ValueMetric label="ROS VORP" value={preferred.rosVorp.toFixed(1)} /></div>
    </div>
    <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 border-t border-slate-800 pt-3 text-xs text-slate-400"><span>Floor <b className="text-slate-200">{preferred.floorValue.toFixed(1)}</b></span><span>Median <b className="text-slate-200">{preferred.medianValue.toFixed(1)}</b></span><span>Ceiling <b className="text-slate-200">{preferred.ceilingValue.toFixed(1)}</b></span><span>{preferred.expectedGamesRemaining} expected games</span>{value.league && <span className="text-cyan-300">{leagueName ?? "League"} adjusted · General {value.general.value.toFixed(1)}</span>}</div>
  </Card>;
}

function ValueMetric({ label, value }: { label: string; value: string }) {
  return <div className="min-w-20 rounded-xl bg-slate-950/65 px-3 py-2"><p className="text-[9px] font-black uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 text-sm font-black text-slate-100">{value}</p></div>;
}

