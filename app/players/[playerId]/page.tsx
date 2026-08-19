import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PlayerProjectionCard } from "@/components/players/player-projection-card";
import { PlayerValueCard } from "@/components/players/player-value-card";
import { PlayerWeeklyProjections } from "@/components/players/player-weekly-projections";
import { PlayerHistory } from "@/components/players/player-history";
import { DepthChart } from "@/components/nfl/depth-chart";
import { SCORING_COLUMNS, resolveScoringSelection } from "@/lib/players/filters";
import { getHistoricalPositionFinishes, getPlayerDetail, getScoringLeagues } from "@/lib/players/queries";
import { withLeagueScoring, withLeagueWeeklyScoring } from "@/lib/fantasy/league-scoring";
import { getPlayerProjectionSeries } from "@/lib/projections/service";
import { scoringSettingsForMode } from "@/lib/projections/scoring";
import { getPlayerValue } from "@/lib/player-values/service";
import type { ScoringFormat, SeasonType } from "@/lib/players/types";
import { createClient } from "@/lib/supabase/server";
import { getWeeklyMatchups, matchupContextByTeam } from "@/lib/nfl/schedule-service";
import type { MatchupContext } from "@/lib/nfl/types";
import { getOffensiveDepthChartForTeam } from "@/lib/nfl/depth-chart-service";
import { publicPlayerDataMessage } from "@/lib/players/data-errors";

const number = (value: unknown) => Number(value ?? 0);
const display = (value: unknown, digits = 0) => value === null || value === undefined || value === "" ? "—" : number(value).toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
const percent = (value: unknown) => value === null || value === undefined || value === "" ? "—" : `${display(number(value) * 100, 1)}%`;
const first = (input: string | string[] | undefined) => Array.isArray(input) ? input[0] : input;

export default async function PlayerDetailPage({ params, searchParams }: { params: Promise<{ playerId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ playerId }, query] = await Promise.all([params, searchParams]);
  let scoringLeagues: Awaited<ReturnType<typeof getScoringLeagues>> = [];
  try { scoringLeagues = await getScoringLeagues(); } catch (error) { console.error("Unable to load league scoring settings", error); }
  const selectedLeague = scoringLeagues.find((league) => league.id === first(query.leagueId)) ?? scoringLeagues[0] ?? null;
  const scoring = resolveScoringSelection(first(query.scoring), Boolean(selectedLeague)) as ScoringFormat;
  const seasonType = ((first(query.seasonType) ?? first(query.type)) === "POST" ? "POST" : "REG") as SeasonType;
  const requestedSeason = Number.parseInt(first(query.season) ?? "", 10);
  let detail: Awaited<ReturnType<typeof getPlayerDetail>>;
  try { detail = await getPlayerDetail(playerId, requestedSeason, seasonType); } catch (error) { console.error(error); return <Card className="mx-auto max-w-3xl text-center"><h1 className="text-xl font-bold">Player statistics unavailable</h1><p className="mt-2 text-slate-400">{publicPlayerDataMessage(error)}</p><Link className="mt-5 inline-block text-cyan-300" href="/players">Return to players</Link></Card>; }
  if (!detail) notFound();
  const { player, seasons, season } = detail;
  const canonicalPlayerId = player.id;
  const summary = detail.summary && scoring === "league" && selectedLeague ? withLeagueScoring(detail.summary, selectedLeague.scoring_settings) : detail.summary;
  const weeks = scoring === "league" && selectedLeague ? detail.weeks.map((week) => withLeagueWeeklyScoring(week, selectedLeague.scoring_settings)) : detail.weeks;
  const position = player.historical_position || player.sleeper_position || "—"; const scoringConfig = SCORING_COLUMNS[scoring];
  let projectionSeries: Awaited<ReturnType<typeof getPlayerProjectionSeries>> = [];
  let playerValue: Awaited<ReturnType<typeof getPlayerValue>> = null;
  const [projectionResult, valueResult] = await Promise.allSettled([
    getPlayerProjectionSeries(canonicalPlayerId, { season: 2026, leagueId: scoring === "league" ? selectedLeague?.id : undefined, scoring }),
    getPlayerValue(canonicalPlayerId, selectedLeague?.id),
  ]);
  if (projectionResult.status === "fulfilled") projectionSeries = projectionResult.value;
  else console.error("Unable to load player projection", projectionResult.reason);
  if (valueResult.status === "fulfilled") playerValue = valueResult.value;
  else console.error("Unable to load Player Value", valueResult.reason);
  const projection = projectionSeries.at(-1)?.projection ?? null;
  let matchup: MatchupContext | null = null;
  if (projection?.team) {
    try {
      const db = await createClient();
      matchup = matchupContextByTeam(await getWeeklyMatchups(db, projection.season, projection.week)).get(projection.team) ?? null;
    } catch (error) { console.warn("Player matchup enrichment unavailable", error); }
  }
  const scoringSettings = scoring === "league" && selectedLeague
    ? selectedLeague.scoring_settings
    : scoringSettingsForMode(scoring === "league" ? "ppr" : scoring);
  const historicalRows = scoring === "league" && selectedLeague
    ? detail.history.map((row) => withLeagueScoring(row, selectedLeague.scoring_settings))
    : detail.history;
  const [positionFinishes, offensiveDepth] = await Promise.all([
    getHistoricalPositionFinishes(canonicalPlayerId, player.historical_position, historicalRows.map((row) => row.season), scoringSettings),
    getOffensiveDepthChartForTeam(await createClient(), player.team, 2026),
  ]);
  const height = player.height ? `${Math.floor(player.height / 12)}′${player.height % 12}″` : "—";
  const hasPassing = summary && number(summary.pass_attempts) > 0; const hasRushing = summary && number(summary.rush_attempts) > 0; const hasReceiving = summary && number(summary.targets) > 0;
  return <div className="mx-auto max-w-6xl">
    <Link className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white" href={`/players?scoring=${scoring}${selectedLeague ? `&leagueId=${selectedLeague.id}` : ""}`}><ArrowLeft size={16} /> Back to players</Link>
    <header className="mt-5 flex flex-wrap items-start justify-between gap-5"><div><div className="flex items-center gap-3"><h1 className="text-4xl font-black">{player.full_name}</h1><span className="rounded-lg bg-cyan-400/15 px-3 py-1 font-bold text-cyan-200">{position}</span></div><p className="mt-2 text-slate-400">{player.team || "No current team"}{player.sleeper_position && player.sleeper_position !== player.historical_position ? ` · Sleeper ${player.sleeper_position}` : ""}</p><p className="mt-1 text-sm text-slate-500">{player.college || "College unavailable"}{player.rookie_season ? ` · Rookie ${player.rookie_season}` : ""} · {height} / {player.weight ? `${player.weight} lb` : "—"}</p></div>{seasons.length > 0 && <form className="grid grid-cols-3 gap-2"><label className="text-xs text-slate-400">Season<select name="season" defaultValue={season ?? undefined} className="mt-1 block rounded-lg border bg-slate-950 px-3 py-2 text-sm text-white">{seasons.map((item) => <option key={item}>{item}</option>)}</select></label><label className="text-xs text-slate-400">Scoring<select name="scoring" defaultValue={scoring} className="mt-1 block rounded-lg border bg-slate-950 px-3 py-2 text-sm text-white">{scoringLeagues.length > 0 && <option value="league">League Scoring</option>}<option value="standard">Standard</option><option value="half_ppr">Half PPR</option><option value="ppr">PPR</option></select></label><label className="text-xs text-slate-400">Type<select name="seasonType" defaultValue={seasonType} className="mt-1 block rounded-lg border bg-slate-950 px-3 py-2 text-sm text-white"><option value="REG">REG</option><option value="POST">POST</option></select></label>{scoringLeagues.length > 0 && <label className="col-span-3 text-xs text-slate-400">Sleeper league<select name="leagueId" defaultValue={selectedLeague?.id} className="mt-1 block w-full rounded-lg border bg-slate-950 px-3 py-2 text-sm text-white">{scoringLeagues.map((league) => <option key={league.id} value={league.id}>{league.name} · {league.season}</option>)}</select></label>}<Button className="col-span-3 py-1.5 text-sm">Update season</Button></form>}</header>
    {projection && <PlayerProjectionCard projection={projection} position={position} matchup={matchup} />}
    {playerValue && <PlayerValueCard value={playerValue} leagueName={selectedLeague?.name} />}
    <PlayerWeeklyProjections rows={projectionSeries} currentWeek={projection?.week} />
    <PlayerHistory rows={historicalRows} ppgKey={scoringConfig.ppg} positionFinishes={positionFinishes} />
    <section className="mt-6"><DepthChart team={`${player.team ?? "NFL team"} offense`} players={offensiveDepth} highlightedPlayerId={canonicalPlayerId} compact /></section>
    {summary ? <>
      <section className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><Metric label={`${SCORING_COLUMNS[scoring].label} PPG`} value={display(summary[scoringConfig.ppg], 1)} accent /><Metric label="Games" value={display(summary.games_played)} /><Metric label="Total Yards" value={display(summary.total_yards)} /><Metric label="Total Touchdowns" value={display(summary.total_touchdowns)} /></section>
      <div className="mt-6 grid gap-5 lg:grid-cols-2"><StatSection title="Fantasy summary" stats={[["Standard", summary.fantasy_points_standard, "", 1], ["Half PPR", summary.fantasy_points_half_ppr, "", 1], ["PPR", summary.fantasy_points_ppr, "", 1], ...(scoring === "league" ? [["League", summary.fantasy_points_league, "", 1] as Stat] : []), ["True Touches", summary.true_touches], ["Snap Share", summary.snap_share, "%", 1, true], ["Games", summary.games_played]]} />
        {hasPassing && <StatSection title="Passing" stats={[["Attempts", summary.pass_attempts], ["Completions", summary.completions], ["Completion", summary.completion_percentage, "%", 1, true], ["Passing Yards", summary.passing_yards], ["Yards / Attempt", summary.yards_per_pass_attempt, "", 1], ["Passing TD", summary.passing_touchdowns], ["INT Thrown", summary.interceptions_thrown], ["First Downs", summary.passing_first_downs], ["Air Yards", summary.passing_air_yards], ["Passer Rating", summary.passer_rating, "", 1], ["Times Sacked", summary.times_sacked], ["Pressure", summary.pressure_percentage, "%", 1, true]]} />}
        {hasRushing && <StatSection title="Rushing" stats={[["Attempts", summary.rush_attempts], ["Yards", summary.rushing_yards], ["Yards / Carry", summary.yards_per_carry, "", 1], ["Rushing TD", summary.rushing_touchdowns], ["First Downs", summary.rushing_first_downs], ["Red Zone Att", summary.rush_attempts_red_zone], ["Goal-to-Go Att", summary.rush_attempts_goal_to_go], ["RZ Rush Share", summary.red_zone_rush_share, "%", 1, true]]} />}
        {hasReceiving && <StatSection title="Receiving" stats={[["Targets", summary.targets], ["Receptions", summary.receptions], ["Yards", summary.receiving_yards], ["Yards / Target", summary.yards_per_target, "", 1], ["Yards / Reception", summary.yards_per_reception, "", 1], ["Receiving TD", summary.receiving_touchdowns], ["Air Yards", summary.receiving_air_yards], ["YAC", summary.yards_after_catch], ["YAC / Reception", summary.yards_after_catch_per_reception, "", 1], ["Receiving aDOT", summary.receiving_adot, "", 1]]} />}
        <StatSection title="nflverse advanced" stats={[["Passing EPA", summary.passing_epa, "", 1], ["Passing CPOE", summary.passing_cpoe, "", 1], ["PACR", summary.pacr, "", 2], ["Rushing EPA", summary.rushing_epa, "", 1], ["Receiving EPA", summary.receiving_epa, "", 1], ["RACR", summary.racr, "", 2], ["Target Share", summary.average_target_share, "%", 1, true], ["Air Yards Share", summary.average_air_yards_share, "%", 1, true], ["WOPR", summary.average_wopr, "", 2]]} />
        <StatSection title="Usage" stats={[["Offense Snaps", summary.offense_snaps], ["Team Snaps", summary.team_offense_snaps], ["Snap Share", summary.snap_share, "%", 1, true], ["True Touches", summary.true_touches]]} />
      </div>
      <Card className="mt-6 overflow-hidden p-0"><div className="border-b border-slate-800 px-5 py-4"><h2 className="text-xl font-bold">Weekly game log</h2><p className="text-sm text-slate-400">{season} {seasonType} · position-aware provider rows</p></div><div className="overflow-x-auto">{position === "QB" ? <QuarterbackLog weeks={weeks} pointsKey={scoringConfig.points as string} /> : position === "RB" ? <RunningBackLog weeks={weeks} pointsKey={scoringConfig.points as string} /> : <ReceiverLog weeks={weeks} pointsKey={scoringConfig.points as string} />}</div></Card>
      <p className="mt-4 text-xs text-slate-500">Weekly values come from nflverse. Season efficiency is derived from summed numerators and denominators. Snap, pressure, and red-zone fields are unavailable until a separate trusted source is integrated.</p>
    </> : <Card className="mt-7 text-center"><h2 className="font-bold">No stats for this selection</h2><p className="mt-2 text-slate-400">This player has no {seasonType} rows for the selected season.</p></Card>}
  </div>;
}

type Week = Record<string, unknown> & { week: number; game_id: string; team: string };
const Cell = ({ value, digits = 0 }: { value: unknown; digits?: number }) => <td className="px-3 py-3">{display(value, digits)}</td>;
function LogTable({ headers, weeks, render }: { headers: string[]; weeks: Week[]; render: (week: Week) => React.ReactNode }) { return <table className="w-full min-w-[950px] text-sm"><thead className="bg-slate-950/80 text-left text-xs uppercase text-slate-400"><tr>{headers.map((header) => <th key={header} className="px-3 py-3">{header}</th>)}</tr></thead><tbody className="divide-y divide-slate-800">{weeks.map((week) => <tr key={`${week.game_id}-${week.week}`}>{render(week)}</tr>)}</tbody></table>; }
function BaseCells({ week }: { week: Week }) { return <><td className="px-3 py-3 font-bold">{week.week}</td><td className="px-3 py-3">{week.team || "—"}</td></>; }
function QuarterbackLog({ weeks, pointsKey }: { weeks: Week[]; pointsKey: string }) { return <LogTable headers={["Week", "Team", "Att", "Comp", "Pass Yds", "Y/A", "Pass TD", "INT", "Rush Att", "Rush Yds", "Rush TD", "Fantasy"]} weeks={weeks} render={(week) => <><BaseCells week={week} /><Cell value={week.pass_attempts} /><Cell value={week.completions} /><Cell value={week.passing_yards} /><Cell value={week.yards_per_attempt} digits={1} /><Cell value={week.passing_touchdowns} /><Cell value={week.interceptions_thrown} /><Cell value={week.rush_attempts} /><Cell value={week.rushing_yards} /><Cell value={week.rushing_touchdowns} /><Cell value={week[pointsKey]} digits={1} /></>} />; }
function RunningBackLog({ weeks, pointsKey }: { weeks: Week[]; pointsKey: string }) { return <LogTable headers={["Week", "Team", "Rush Att", "Rush Yds", "Y/C", "Rush TD", "Targets", "Rec", "Rec Yds", "Rec TD", "Touches", "Snap", "Fantasy"]} weeks={weeks} render={(week) => <><BaseCells week={week} /><Cell value={week.rush_attempts} /><Cell value={week.rushing_yards} /><Cell value={week.yards_per_carry} digits={1} /><Cell value={week.rushing_touchdowns} /><Cell value={week.targets} /><Cell value={week.receptions} /><Cell value={week.receiving_yards} /><Cell value={week.receiving_touchdowns} /><Cell value={number(week.rush_attempts) + number(week.receptions)} /><td className="px-3 py-3">{percent(week.offense_snap_percentage)}</td><Cell value={week[pointsKey]} digits={1} /></>} />; }
function ReceiverLog({ weeks, pointsKey }: { weeks: Week[]; pointsKey: string }) { return <LogTable headers={["Week", "Team", "Targets", "Rec", "Rec Yds", "Y/Tgt", "Y/Rec", "Rec TD", "Air Yds", "YAC", "Snap", "Fantasy"]} weeks={weeks} render={(week) => <><BaseCells week={week} /><Cell value={week.targets} /><Cell value={week.receptions} /><Cell value={week.receiving_yards} /><Cell value={week.yards_per_target} digits={1} /><Cell value={week.yards_per_reception} digits={1} /><Cell value={week.receiving_touchdowns} /><Cell value={week.receiving_air_yards} /><Cell value={week.yards_after_catch} /><td className="px-3 py-3">{percent(week.offense_snap_percentage)}</td><Cell value={week[pointsKey]} digits={1} /></>} />; }
function Metric({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) { return <Card><p className="text-sm text-slate-400">{label}</p><p className={`mt-2 text-3xl font-black ${accent ? "text-cyan-300" : ""}`}>{value}</p></Card>; }
type Stat = [string, unknown, string?, number?, boolean?];
function StatSection({ title, stats }: { title: string; stats: Stat[] }) { return <Card><h2 className="font-bold">{title}</h2><dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">{stats.map(([label, value, suffix = "", digits = 0, isPercentage = false]) => <div key={label}><dt className="text-xs uppercase text-slate-500">{label}</dt><dd className="mt-1 text-xl font-bold">{isPercentage ? percent(value) : `${display(value, digits)}${suffix}`}</dd></div>)}</dl></Card>; }
