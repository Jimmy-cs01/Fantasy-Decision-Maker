import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { arbitrateProjection } from "../lib/projections/arbitration";
import type { ProjectedStatLine, ProjectionConfidence } from "../lib/projections/types";

function parseCsv(path: string) {
  const source = readFileSync(path, "utf8");
  const rows: string[][] = [];
  let row: string[] = []; let field = ""; let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '"') {
      if (quoted && source[index + 1] === '"') { field += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === "," && !quoted) { row.push(field); field = ""; }
    else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && source[index + 1] === "\n") index += 1;
      row.push(field); field = ""; if (row.some(Boolean)) rows.push(row); row = [];
    } else field += character;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const headers = rows.shift() ?? [];
  return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

const projectionPath = process.argv.find((value) => value.startsWith("--input="))?.split("=")[1]
  ?? "data/processed/player_projections_v2.csv";
const projections = parseCsv(projectionPath);
const identities = new Map(parseCsv("data/processed/player_identity.csv").map((row) => [row.player_id, row]));
const depthRoles = new Map<string, Record<string, string>>();
for (const row of parseCsv("data/processed/depth_chart_roles.csv")) {
  if (row.season === "2026" && !depthRoles.has(row.gsis_id)) depthRoles.set(row.gsis_id, row);
}

let audit = projections.map((row) => {
  const identity = identities.get(row.gsis_id);
  const role = depthRoles.get(row.gsis_id);
  const result = arbitrateProjection({
    position: row.position,
    rawStats: JSON.parse(row.projected_stats) as ProjectedStatLine,
    modelPpr: Number(row.model_projection_ppr),
    // The generated projection carries the season-specific roster team. The
    // identity export can lag current rosters, so it is only a fallback.
    currentTeam: row.team || identity?.sleeper_current_team || null,
    depth: role ? { depthRank: Number(role.depth_rank), depthPosition: role.depth_position, isStarter: role.is_starter.toLowerCase() === "true" } : null,
    modelConfidence: row.confidence as ProjectionConfidence,
  });
  const reasons = result.drivers.join("; ");
  return {
    player_id: row.gsis_id,
    player: identity?.player_name ?? role?.player_name ?? row.gsis_id,
    position: row.position,
    team: row.team || identity?.sleeper_current_team || null,
    depth: role ? `${role.depth_position}${role.depth_rank}` : null,
    model_ppg: Number(row.model_projection_ppr),
    opportunity_adjusted_ppg: result.opportunityAdjustedPpr,
    vegas_ppg: result.vegasPpr,
    sleeper_ppg: null,
    final_ppg: result.finalPpr,
    difference: result.finalPpr - Number(row.model_projection_ppr),
    opportunity_confidence: result.opportunityConfidence,
    outlier: result.outlierStatus,
    reasons,
  };
});

const reconciliationPath = "data/processed/projection_reconciliation_report.json";
let reconciliationHealth: { safe_to_apply?: boolean; required_failures?: number } | null = null;
if (existsSync(reconciliationPath)) {
  const reconciliation = JSON.parse(readFileSync(reconciliationPath, "utf8")) as {
    safe_to_apply?: boolean;
    required_failures?: number;
    rows?: Array<{
      player_id: string;
      gsis_id: string | null;
      team: string | null;
      depth_role: string | null;
      recent_games: number;
      recent_opportunity_share: number | null;
      raw_model_ppr: number;
      opportunity_adjusted_ppr: number;
      vegas_ppr: number | null;
      final_ppr: number;
      outlier: "normal" | "watch" | "large" | "extreme";
    }>;
  };
  const byPlayer = new Map((reconciliation.rows ?? []).flatMap((row) => row.gsis_id ? [[row.gsis_id, row] as const] : []));
  if (byPlayer.size === audit.length) {
    reconciliationHealth = reconciliation;
    audit = audit.map((row) => {
      const remote = byPlayer.get(row.player_id);
      return remote ? {
        ...row,
        team: remote.team,
        depth: remote.depth_role,
        model_ppg: remote.raw_model_ppr,
        opportunity_adjusted_ppg: remote.opportunity_adjusted_ppr,
        vegas_ppg: remote.vegas_ppr,
        final_ppg: remote.final_ppr,
        difference: remote.final_ppr - remote.raw_model_ppr,
        outlier: remote.outlier,
        recent_games: remote.recent_games,
        recent_opportunity_share: remote.recent_opportunity_share,
      } : row;
    });
  }
}

const byCorrection = [...audit].sort((left, right) => Math.abs(right.difference) - Math.abs(left.difference));
const topFinal = [...audit].sort((left, right) => right.final_ppg - left.final_ppg).slice(0, 25);
const noTeamAboveOne = audit.filter((row) => !row.team && row.final_ppg > 1);
const rb4AboveEight = audit.filter((row) => row.position === "RB" && Number(row.depth?.replace(/\D/g, "") ?? 0) >= 4 && row.final_ppg > 8);
const report = {
  generated_at: new Date().toISOString(),
  input: projectionPath,
  reconciliation_input: reconciliationHealth ? reconciliationPath : null,
  reconciliation_safe_to_apply: reconciliationHealth?.safe_to_apply ?? null,
  reconciliation_required_failures: reconciliationHealth?.required_failures ?? null,
  total: audit.length,
  top_final: topFinal,
  largest_corrections: byCorrection.slice(0, 25),
  no_team_above_one: noTeamAboveOne,
  rb4_plus_above_eight: rb4AboveEight,
  rows: audit,
};
writeFileSync("data/processed/projection_integrity_report.json", JSON.stringify(report, null, 2));
console.log(`Audited ${audit.length} projections.`);
if (reconciliationHealth) {
  console.log(`Reconciliation context: safe to apply=${reconciliationHealth.safe_to_apply ? "YES" : "NO"}; required failures=${reconciliationHealth.required_failures ?? "unknown"}`);
}
const outliers = audit.reduce<Record<string, number>>((counts, row) => {
  counts[row.outlier] = (counts[row.outlier] ?? 0) + 1;
  return counts;
}, {});
console.log(`Outliers: normal=${outliers.normal ?? 0} watch=${outliers.watch ?? 0} large=${outliers.large ?? 0} extreme=${outliers.extreme ?? 0}`);
console.log(`No-team players above 1 final PPG: ${noTeamAboveOne.length}`);
console.log(`RB4+ players above 8 final PPG: ${rb4AboveEight.length}`);
console.log("Largest corrections:");
for (const row of byCorrection.slice(0, 12)) console.log(`  ${row.player} (${row.position}, ${row.depth ?? "depth —"}): ${row.model_ppg.toFixed(1)} -> ${row.final_ppg.toFixed(1)} (${row.difference.toFixed(1)})`);
console.log("Report: data/processed/projection_integrity_report.json");
