import { Activity, Gauge, TrendingUp } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { ProjectionResponse } from "@/lib/projections/types";

const labels: Record<string, string> = {
  passAttempts: "Pass Att", completions: "Comp", passingYards: "Pass Yds",
  passingTouchdowns: "Pass TD", interceptionsThrown: "INT", rushAttempts: "Rush Att",
  rushingYards: "Rush Yds", rushingTouchdowns: "Rush TD", targets: "Targets",
  receptions: "Rec", receivingYards: "Rec Yds", receivingTouchdowns: "Rec TD",
};

const statKeys: Record<string, string[]> = {
  QB: ["passAttempts", "completions", "passingYards", "passingTouchdowns", "interceptionsThrown", "rushAttempts", "rushingYards", "rushingTouchdowns"],
  RB: ["rushAttempts", "rushingYards", "rushingTouchdowns", "targets", "receptions", "receivingYards", "receivingTouchdowns"],
  WR: ["targets", "receptions", "receivingYards", "receivingTouchdowns", "rushAttempts", "rushingYards"],
  TE: ["targets", "receptions", "receivingYards", "receivingTouchdowns"],
};

const value = (input: number) => input.toLocaleString(undefined, { maximumFractionDigits: 1 });

export function PlayerProjectionCard({ projection, position }: { projection: ProjectionResponse; position: string }) {
  const visibleStats = (statKeys[position] ?? Object.keys(projection.stats))
    .filter((key) => projection.stats[key] !== undefined && (projection.stats[key] !== 0 || ["interceptionsThrown", "rushingTouchdowns", "receivingTouchdowns"].includes(key)));
  return <Card className="mt-7 overflow-hidden border-cyan-400/20 bg-gradient-to-br from-cyan-400/[0.08] to-slate-950">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-cyan-300"><TrendingUp size={16} /> Week {projection.week} projection</div>
        <div className="mt-2 flex items-end gap-2"><span className="text-4xl font-black text-white">{value(projection.projectedPoints)}</span><span className="pb-1 text-sm font-semibold text-slate-400">projected points</span></div>
        <p className="mt-1 text-xs text-slate-500">{projection.scoringMode === "league" ? "Selected Sleeper league scoring" : projection.scoringMode.replace("_", " ").toUpperCase()} · Model {projection.modelVersion}</p>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        {[["Floor", projection.floor], ["Median", projection.median], ["Ceiling", projection.ceiling]].map(([label, amount]) => <div key={label as string} className="min-w-16 rounded-xl bg-slate-950/70 px-3 py-2"><p className="text-[10px] font-bold uppercase text-slate-500">{label}</p><p className="mt-1 font-black">{value(amount as number)}</p></div>)}
      </div>
    </div>
    <div className="mt-5 grid gap-5 border-t border-slate-800/80 pt-5 lg:grid-cols-[1.4fr_1fr]">
      <div><h2 className="flex items-center gap-2 text-sm font-bold"><Activity size={15} className="text-cyan-300" /> Projected stat line</h2><dl className="mt-3 grid grid-cols-3 gap-x-4 gap-y-3 sm:grid-cols-4">{visibleStats.map((key) => <div key={key}><dt className="text-[10px] font-bold uppercase text-slate-500">{labels[key] ?? key}</dt><dd className="mt-0.5 font-bold">{value(projection.stats[key])}</dd></div>)}</dl></div>
      <div><h2 className="flex items-center gap-2 text-sm font-bold"><Gauge size={15} className="text-cyan-300" /> Why</h2><ul className="mt-3 space-y-2 text-sm text-slate-300">{projection.drivers.map((driver) => <li key={driver} className="flex gap-2"><span className="text-cyan-300">•</span><span>{driver}</span></li>)}</ul><p className="mt-3 text-xs font-bold uppercase tracking-wide text-slate-500">Confidence: <span className="text-slate-300">{projection.confidence}</span></p>{projection.vegasProjection !== null && <p className="mt-2 text-xs text-slate-500">Model {projection.modelProjection?.toFixed(1)} · Market {projection.vegasProjection.toFixed(1)}</p>}</div>
    </div>
  </Card>;
}

