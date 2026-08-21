"use client";

import {
  ChevronDown,
  Search,
  SlidersHorizontal,
  Sparkles,
  UsersRound,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { PlayerAvatar } from "@/components/players/player-avatar";
import { PlayerLink } from "@/components/players/player-link";
import { TeamChoiceStrip } from "@/components/trades/team-choice-strip";
import {
  evaluateTrade,
  classifyDepthImpact,
  describeDepthImpact,
  describeTradeImpact,
  findTradeSuggestions,
  tradeTotals,
  type TeamTradeImpact,
  type TradePlayer,
  type TradeSearchFilters,
  type TradeSuggestion,
} from "@/lib/trades/engine";
import { toggleTradePlayerId } from "@/lib/trades/selection";

export interface TradeTeam {
  id: string;
  name: string;
  isMyTeam: boolean;
  players: TradePlayer[];
}
type PositionFilter = "ALL" | "QB" | "RB" | "WR" | "TE" | "K";
const POSITIONS: PositionFilter[] = ["ALL", "QB", "RB", "WR", "TE", "K"];

export function TradeFinder({
  teams,
  rosterPositions,
  analyticsAvailable,
  leagueTeams,
  projectionLabel,
}: {
  teams: TradeTeam[];
  rosterPositions: string[];
  analyticsAvailable: boolean;
  leagueTeams: number;
  projectionLabel?: string | null;
}) {
  const myTeam = teams.find((team) => team.isMyTeam) ?? teams[0];
  const [mode, setMode] = useState<"manual" | "auto">("manual");
  const [mobileSide, setMobileSide] = useState<"send" | "receive">("send");
  const [teamAId, setTeamAId] = useState(myTeam?.id ?? "");
  const [teamBId, setTeamBId] = useState(
    teams.find((team) => team.id !== myTeam?.id)?.id ?? "",
  );
  const [sendIds, setSendIds] = useState<string[]>([]);
  const [receiveIds, setReceiveIds] = useState<string[]>([]);
  const [autoSelectedIds, setAutoSelectedIds] = useState<string[]>([]);
  const [filters, setFilters] = useState<TradeSearchFilters>({
    sendCount: null,
    receiveCount: null,
    sendPosition: null,
    receivePosition: null,
    minimumFairness: 45,
    starterUpgradeOnly: false,
  });
  const [suggestions, setSuggestions] = useState<TradeSuggestion[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [searchError, setSearchError] = useState("");
  const teamA = teams.find((team) => team.id === teamAId);
  const teamB = teams.find((team) => team.id === teamBId);
  const send =
    teamA?.players.filter((player) => sendIds.includes(player.id)) ?? [];
  const receive =
    teamB?.players.filter((player) => receiveIds.includes(player.id)) ?? [];
  const totals = tradeTotals(send, receive);
  const hasCompleteValues =
    send.length > 0 &&
    receive.length > 0 &&
    [...send, ...receive].every((player) => player.value !== null);
  const otherRosters = useMemo(
    () =>
      teams
        .filter((team) => team.id !== myTeam?.id)
        .map((team) => team.players),
    [teams, myTeam?.id],
  );
  const toggle = (
    id: string,
    values: string[],
    setter: (values: string[]) => void,
  ) => setter(toggleTradePlayerId(values, id));
  const selectedAutoPlayers =
    myTeam?.players.filter((player) => autoSelectedIds.includes(player.id)) ??
    [];
  const selectionExceedsPackage = Boolean(
    filters.sendCount && autoSelectedIds.length > filters.sendCount,
  );
  const runAuto = (wholeRoster: boolean) => {
    setIsSearching(true);
    setSearchError("");
    window.setTimeout(() => {
      try {
      setSuggestions(
        findTradeSuggestions({
          myRoster: myTeam?.players ?? [],
          otherRosters,
          rosterPositions,
          leagueTeams,
            requiredPlayerIds: wholeRoster ? [] : autoSelectedIds,
            filters,
        }),
      );
        setHasSearched(true);
      } catch (error) {
        setSuggestions([]);
        setHasSearched(true);
        setSearchError(
          error instanceof Error
            ? error.message
            : "Trade recommendations could not be generated.",
        );
      } finally {
      setIsSearching(false);
      }
    }, 0);
  };

  if (!myTeam)
    return (
      <p className="rounded-xl border border-dashed border-slate-700 p-5 text-slate-400">
        No synchronized league teams are available.
      </p>
    );
  if (teams.length < 2)
    return (
      <TradeSearchEmpty
        title="No opposing team is available"
        detail="Sync at least two league rosters before building or generating a trade."
      />
    );
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
      <SegmentedControl
        items={[
          { id: "manual", label: "Manual Trade" },
          { id: "auto", label: "Find Trades" },
        ]}
        selected={mode}
        onSelect={(id) => setMode(id as "manual" | "auto")}
      />
        <p className="text-[10px] font-bold tracking-[.12em] text-slate-500 uppercase">
          League-scored weekly projection
          {projectionLabel ? ` · ${projectionLabel}` : ""}
        </p>
      </div>
      {mode === "manual" ? (
        <div className="pb-44 lg:pb-0">
          <div className="mt-4 lg:hidden">
            <SegmentedControl
              items={[
                {
                  id: "send",
                  label: `You send${sendIds.length ? ` (${sendIds.length})` : ""}`,
                },
                {
                  id: "receive",
                  label: `You receive${receiveIds.length ? ` (${receiveIds.length})` : ""}`,
                },
              ]}
              selected={mobileSide}
              onSelect={(id) => setMobileSide(id as "send" | "receive")}
              fullWidth
            />
            <div className="mt-3">
              {mobileSide === "send" ? (
                <TradeSide
                  label="My Team sends"
                  teams={teams}
                  teamId={teamAId}
                  setTeamId={(id) => {
                    setTeamAId(id);
                    setSendIds([]);
                  }}
                  disabledTeamId={teamBId}
                  selected={sendIds}
                  toggle={(id) => toggle(id, sendIds, setSendIds)}
                />
              ) : (
                <TradeSide
                  label="Other Team sends"
                  teams={teams}
                  teamId={teamBId}
                  setTeamId={(id) => {
                    setTeamBId(id);
                    setReceiveIds([]);
                  }}
                  disabledTeamId={teamAId}
                  selected={receiveIds}
                  toggle={(id) => toggle(id, receiveIds, setReceiveIds)}
                />
              )}
            </div>
          </div>
          <div className="mt-4 hidden gap-4 lg:grid lg:grid-cols-2">
            <TradeSide
              label="My Team sends"
              teams={teams}
              teamId={teamAId}
              setTeamId={(id) => {
                setTeamAId(id);
                setSendIds([]);
              }}
              disabledTeamId={teamBId}
              selected={sendIds}
              toggle={(id) => toggle(id, sendIds, setSendIds)}
            />
            <TradeSide
              label="Other Team sends"
              teams={teams}
              teamId={teamBId}
              setTeamId={(id) => {
                setTeamBId(id);
                setReceiveIds([]);
              }}
              disabledTeamId={teamAId}
              selected={receiveIds}
              toggle={(id) => toggle(id, receiveIds, setReceiveIds)}
            />
          </div>
          <TradeSummary
            selectionSignature={`${sendIds.join("+")}->${receiveIds.join("+")}`}
            send={send}
            receive={receive}
            totals={totals}
            complete={hasCompleteValues}
            analyticsAvailable={analyticsAvailable}
            myRoster={teamA?.players ?? []}
            opponentRoster={teamB?.players ?? []}
            rosterPositions={rosterPositions}
            leagueTeams={leagueTeams}
          />
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-3 sm:p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-black">Automatic Trade Finder</h2>
                <p className="mt-1 text-sm text-slate-400">
                  Select up to three players you want to move, or search your
                  whole roster in one click.
                </p>
              </div>
            </div>
            <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(20rem,.75fr)]">
              <div>
                <RosterSelector
                  players={myTeam.players}
                  selected={autoSelectedIds}
                  onToggle={(id) =>
                    setAutoSelectedIds((current) =>
                      current.includes(id)
                        ? current.filter((item) => item !== id)
                        : current.length < 3
                          ? [...current, id]
                          : current,
                    )
                  }
                  compact
                />
                {autoSelectedIds.length ? (
                  <p className="mt-2 text-xs text-cyan-200">
                    Every package will include{" "}
                    {selectedAutoPlayers
                      .map((player) => player.name)
                      .join(", ")}
                    .
                  </p>
            ) : (
                  <p className="mt-2 text-xs text-slate-500">
                    No player selected. Use the whole-roster action to let Jimmy
                    GM find the best movable assets.
              </p>
            )}
              </div>
              <TradeFilters
                filters={filters}
                onChange={(next) => {
                  setFilters(next);
                  setSuggestions([]);
                  setHasSearched(false);
                }}
              />
            </div>
            {selectionExceedsPackage ? (
              <p
                role="alert"
                className="mt-3 text-sm font-semibold text-amber-300"
              >
                The selected players exceed your “players I send” filter.
                Increase that count or remove a player.
              </p>
            ) : null}
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              disabled={
                !analyticsAvailable ||
                isSearching ||
                  !autoSelectedIds.length ||
                  selectionExceedsPackage
              }
                onClick={() => runAuto(false)}
                className="min-h-11 rounded-xl bg-cyan-400 px-5 py-2 font-black text-slate-950 disabled:opacity-40"
            >
              {isSearching
                ? "Searching…"
                  : `Find Trades${autoSelectedIds.length ? ` (${autoSelectedIds.length} selected)` : ""}`}
              </button>
              {!autoSelectedIds.length ? (
                <button
                  type="button"
                  disabled={!analyticsAvailable || isSearching}
                  onClick={() => runAuto(true)}
                  className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-cyan-400/40 px-5 py-2 font-black text-cyan-200 disabled:opacity-40"
                >
                  <UsersRound size={17} /> Find Trades From Whole Roster
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setAutoSelectedIds([])}
                  className="min-h-11 rounded-xl px-4 text-sm font-bold text-slate-400 hover:text-white"
                >
                  Clear selection
            </button>
              )}
            </div>
          </section>
          <div aria-live="polite" className="grid gap-4">
            {isSearching ? (
              <TradeResultsSkeleton />
            ) : searchError ? (
              <TradeSearchEmpty
                title="Trade analysis unavailable"
                detail={`${searchError} Your roster selection is still available; try again.`}
              />
            ) : suggestions.length ? (
              [
                ...new Set(
                  suggestions.map((suggestion) => suggestion.opponentTeamId),
                ),
              ].map((opponentTeamId) => {
                const teamSuggestions = suggestions.filter(
                  (suggestion) => suggestion.opponentTeamId === opponentTeamId,
                );
                const teamName =
                  teams.find((team) => team.id === opponentTeamId)?.name ??
                  "League team";
                return (
                  <section key={opponentTeamId} className="space-y-2">
                    <h3 className="px-1 text-xs font-black tracking-[0.18em] text-cyan-300 uppercase">
                      vs {teamName}
                    </h3>
                    {teamSuggestions.map((suggestion) => (
                      <Suggestion
                    key={`${suggestion.send.map((player) => player.id).join("+")}->${suggestion.receive.map((player) => player.id).join("+")}`}
                    suggestion={suggestion}
                    teamName={teamName}
                      />
                    ))}
                  </section>
                );
              })
            ) : (
              <TradeSearchEmpty
                title={
                  hasSearched
                    ? "No trades match these filters"
                    : analyticsAvailable
                      ? "Choose how you want to search"
                      : "Recommendations are temporarily unavailable"
                }
                detail={
                  hasSearched
                    ? "Try Any for one package count, lower the minimum quality, or turn off starter-upgrade-only."
                    : analyticsAvailable
                      ? "Select players above, or search your whole roster without any setup."
                      : "Manual roster selection remains available, and missing projection values display —."
                }
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SegmentedControl({
  items,
  selected,
  onSelect,
  fullWidth = false,
}: {
  items: Array<{ id: string; label: string }>;
  selected: string;
  onSelect: (id: string) => void;
  fullWidth?: boolean;
}) {
  return (
    <div
      className={`${fullWidth ? "flex w-full" : "inline-flex"} rounded-xl bg-slate-900 p-1 text-sm font-bold`}
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          aria-pressed={selected === item.id}
          onClick={() => onSelect(item.id)}
          className={`${fullWidth ? "flex-1" : ""} rounded-lg px-3 py-2 transition ${selected === item.id ? "bg-cyan-400 text-slate-950" : "text-slate-400 hover:text-white"}`}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

function TradeSide({
  label,
  teams,
  teamId,
  setTeamId,
  disabledTeamId,
  selected,
  toggle,
}: {
  label: string;
  teams: TradeTeam[];
  teamId: string;
  setTeamId: (id: string) => void;
  disabledTeamId: string;
  selected: string[];
  toggle: (id: string) => void;
}) {
  const team = teams.find((item) => item.id === teamId);
  return (
    <section className="min-w-0 rounded-2xl border border-slate-800 bg-slate-900/70 p-3">
      <p className="text-xs font-black tracking-wider text-cyan-300 uppercase">
        {label}
      </p>
      <TeamChoiceStrip
        items={teams.filter((item) => item.id !== disabledTeamId)}
        selectedId={teamId}
        onSelect={setTeamId}
        label={`${label} team`}
      />
      <div className="mt-3">
        <RosterSelector
          players={team?.players ?? []}
          selected={selected}
          onToggle={toggle}
        />
      </div>
    </section>
  );
}

function RosterSelector({
  players,
  selected,
  onToggle,
  compact = false,
}: {
  players: TradePlayer[];
  selected: string[];
  onToggle: (id: string) => void;
  compact?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [position, setPosition] = useState<PositionFilter>("ALL");
  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return players.filter((player) => {
      const matchesPosition =
        position === "ALL" || player.position === position;
      const haystack =
        `${player.name} ${player.position ?? ""} ${player.nflTeam ?? ""}`.toLowerCase();
      return matchesPosition && (!query || haystack.includes(query));
    });
  }, [players, position, search]);
  return (
    <>
      <label className="relative block">
        <Search
          aria-hidden="true"
          size={15}
          className="absolute top-1/2 left-3 -translate-y-1/2 text-slate-500"
        />
        <span className="sr-only">Search roster</span>
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search name, position, team"
          className="min-h-10 w-full rounded-lg border border-slate-700 bg-slate-950 pr-3 pl-9 text-sm"
        />
      </label>
      <div className="mt-2 flex gap-1 overflow-x-auto pb-1">
        {POSITIONS.map((item) => (
          <button
            key={item}
            type="button"
            aria-pressed={position === item}
            onClick={() => setPosition(item)}
            className={`min-h-9 min-w-11 rounded-full px-2 text-xs font-black ${position === item ? "bg-cyan-400 text-slate-950" : "bg-slate-950 text-slate-400"}`}
          >
            {item}
          </button>
        ))}
      </div>
      <div
        className={`${compact ? "max-h-[22rem] overflow-y-auto overscroll-contain" : "lg:max-h-[31rem] lg:overflow-y-auto lg:overscroll-contain"} mt-2 touch-pan-y divide-y divide-slate-800`}
      >
        {visible.map((player) => (
          <TradePlayerRow
            key={player.id}
            player={player}
            selected={selected.includes(player.id)}
            onToggle={() => onToggle(player.id)}
          />
        ))}
        {!visible.length && (
          <p className="py-6 text-center text-sm text-slate-500">
            No roster players match this filter.
          </p>
        )}
      </div>
    </>
  );
}

const PACKAGE_COUNTS = [null, 1, 2, 3] as const;
const FILTER_POSITIONS = [null, "QB", "RB", "WR", "TE"] as const;

function TradeFilters({
  filters,
  onChange,
}: {
  filters: TradeSearchFilters;
  onChange: (filters: TradeSearchFilters) => void;
}) {
  const packageCount = (label: string, key: "sendCount" | "receiveCount") => (
    <fieldset>
      <legend className="text-[10px] font-black tracking-[.14em] text-slate-500 uppercase">
        {label}
      </legend>
      <div className="mt-1 grid grid-cols-4 gap-1 rounded-xl bg-slate-950/70 p-1">
        {PACKAGE_COUNTS.map((count) => (
          <button
            key={count ?? "any"}
            type="button"
            aria-pressed={(filters[key] ?? null) === count}
            onClick={() => onChange({ ...filters, [key]: count })}
            className={`min-h-9 rounded-lg text-xs font-black ${(filters[key] ?? null) === count ? "bg-cyan-400 text-slate-950" : "text-slate-400 hover:bg-slate-800 hover:text-white"}`}
          >
            {count ?? "Any"}
          </button>
        ))}
      </div>
    </fieldset>
  );
  const positions = (
    label: string,
    key: "sendPosition" | "receivePosition",
  ) => (
    <fieldset>
      <legend className="text-[10px] font-black tracking-[.14em] text-slate-500 uppercase">
        {label}
      </legend>
      <div className="mt-1 flex flex-wrap gap-1">
        {FILTER_POSITIONS.map((position) => (
          <button
            key={position ?? "any"}
            type="button"
            aria-pressed={(filters[key] ?? null) === position}
            onClick={() => onChange({ ...filters, [key]: position })}
            className={`min-h-8 rounded-full px-2.5 text-[11px] font-black ${(filters[key] ?? null) === position ? "bg-cyan-400 text-slate-950" : "bg-slate-950 text-slate-400 hover:text-white"}`}
          >
            {position ?? "Any"}
          </button>
        ))}
      </div>
    </fieldset>
  );
  return (
    <section
      aria-label="Trade search filters"
      className="rounded-xl border border-slate-800 bg-slate-950/45 p-3"
    >
      <div className="flex items-center gap-2">
        <SlidersHorizontal size={15} className="text-cyan-300" />
        <h3 className="text-sm font-black">Trade filters</h3>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        {packageCount("Players I send", "sendCount")}
        {packageCount("Players I receive", "receiveCount")}
      </div>
      <details className="mt-3 border-t border-slate-800 pt-3">
        <summary className="flex cursor-pointer list-none items-center justify-between text-xs font-bold text-slate-300">
          More filters <ChevronDown size={15} />
        </summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {positions("Position willing to trade", "sendPosition")}
          {positions("Position wanted", "receivePosition")}
        </div>
        <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs font-bold text-slate-300">
          <input
            type="checkbox"
            checked={Boolean(filters.starterUpgradeOnly)}
            onChange={(event) =>
              onChange({ ...filters, starterUpgradeOnly: event.target.checked })
            }
            className="size-4 accent-cyan-400"
          />{" "}
          Only show projected starter upgrades
        </label>
        <fieldset className="mt-3">
          <legend className="text-[10px] font-black tracking-[.14em] text-slate-500 uppercase">
            Minimum trade quality
          </legend>
          <div className="mt-1 grid grid-cols-3 gap-1 rounded-xl bg-slate-950/70 p-1">
            {[
              { value: 45, label: "Reasonable" },
              { value: 60, label: "Fair" },
              { value: 75, label: "Strong" },
            ].map((quality) => (
              <button
                key={quality.value}
                type="button"
                aria-pressed={(filters.minimumFairness ?? 45) === quality.value}
                onClick={() =>
                  onChange({ ...filters, minimumFairness: quality.value })
                }
                className={`min-h-9 rounded-lg px-1 text-[11px] font-black ${(filters.minimumFairness ?? 45) === quality.value ? "bg-cyan-400 text-slate-950" : "text-slate-400 hover:bg-slate-800 hover:text-white"}`}
              >
                {quality.label}
              </button>
            ))}
          </div>
        </fieldset>
      </details>
    </section>
  );
}

function TradeSearchEmpty({
  title,
  detail,
}: {
  title: string;
  detail: string;
}) {
  return (
    <section className="rounded-xl border border-dashed border-slate-700 p-5 text-center">
      <h3 className="font-bold text-slate-200">{title}</h3>
      <p className="mt-1 text-sm text-slate-500">{detail}</p>
    </section>
  );
}

export function TradePlayerRow({
  player,
  selected,
  onToggle,
}: {
  player: TradePlayer;
  selected: boolean;
  onToggle: () => void;
}) {
  const ppg = player.projectedPpg ?? player.lastSeasonPpg ?? null;
  return (
    <div className="relative">
      <button
        type="button"
        aria-label={`${selected ? "Remove" : "Add"} ${player.name} ${selected ? "from" : "to"} trade`}
        aria-pressed={selected}
        onClick={onToggle}
        className={`grid min-h-[3.75rem] w-full cursor-pointer grid-cols-[2.75rem_minmax(0,1fr)_auto] items-center gap-2 rounded-lg px-2 py-2 text-left transition focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-cyan-300 ${selected ? "bg-cyan-400/15 ring-1 ring-cyan-300" : "hover:bg-slate-800/60"}`}
      >
        <span className="size-11" aria-hidden="true" />
        <span className="min-w-0">
          <span className="block truncate text-sm font-bold text-white">
            {player.name}
          </span>
          <small className="flex items-center gap-1 text-slate-500">
            <PositionBadge position={player.position} />
            {player.nflTeam ?? "FA"}
          </small>
        </span>
        <span className="grid grid-cols-2 gap-3 text-right tabular-nums">
          <MetricInline label="VALUE" value={player.value} />
          <MetricInline
            label={
              player.projectedPpg == null && player.lastSeasonPpg != null
                ? "2025 PPG"
                : "PROJ PPG"
            }
            value={ppg}
          />
        </span>
        {player.opponent ? (
          <span className="col-start-2 -mt-1 block text-[10px] text-slate-500">
            {player.isHome ? "vs" : "@"} {player.opponent}
            {player.teamImpliedTotal != null
              ? ` · implied ${player.teamImpliedTotal.toFixed(1)}`
              : ""}
          </span>
        ) : null}
      </button>
      <Link
        href={`/players/${encodeURIComponent(player.id)}`}
        aria-label={`View ${player.name} profile`}
        onClick={(event) => event.stopPropagation()}
        className="absolute top-1/2 left-2 z-10 flex size-11 -translate-y-1/2 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-cyan-300"
      >
        <PlayerAvatar name={player.name} headshotUrl={player.headshotUrl} />
      </Link>
    </div>
  );
}

function PositionBadge({ position }: { position: string | null }) {
  return (
    <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-black text-cyan-200">
      {position ?? "—"}
    </span>
  );
}
function MetricInline({
  label,
  value,
}: {
  label: string;
  value: number | null;
}) {
  return (
    <span>
      <small className="block text-[8px] font-black tracking-wide text-slate-600">
        {label}
      </small>
      <b className="text-sm text-cyan-100">
        {value == null ? "—" : value.toFixed(1)}
      </b>
    </span>
  );
}

function TradeSummary({
  send,
  receive,
  totals,
  complete,
  analyticsAvailable,
  myRoster,
  opponentRoster,
  rosterPositions,
  leagueTeams,
  selectionSignature,
}: {
  send: TradePlayer[];
  receive: TradePlayer[];
  totals: ReturnType<typeof tradeTotals>;
  complete: boolean;
  analyticsAvailable: boolean;
  myRoster: TradePlayer[];
  opponentRoster: TradePlayer[];
  rosterPositions: string[];
  leagueTeams: number;
  selectionSignature: string;
}) {
  const [analysisState, setAnalysisState] = useState<{
    signature: string;
    result: ReturnType<typeof evaluateTrade>;
  } | null>(null);
  const analysis =
    analysisState?.signature === selectionSignature
      ? analysisState.result
      : null;
  const analyze = () =>
    setAnalysisState({
      signature: selectionSignature,
      result: evaluateTrade({
        myRoster,
        opponentRoster,
        send,
        receive,
        rosterPositions,
        leagueTeams,
      }),
    });
  return (
    <section className="fixed inset-x-2 bottom-2 z-20 max-h-[70vh] overflow-y-auto rounded-2xl border border-cyan-400/25 bg-slate-950/95 p-3 shadow-2xl backdrop-blur lg:static lg:mt-4 lg:max-h-none lg:overflow-visible lg:p-4">
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-2 lg:gap-4">
        <SummarySide
          label="YOU SEND"
          players={send}
          total={complete ? totals.sendValue : null}
        />
        <div className="pt-4 text-center text-[10px] font-black text-slate-600">
          FOR
        </div>
        <SummarySide
          label="YOU RECEIVE"
          players={receive}
          total={complete ? totals.receiveValue : null}
        />
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 border-t border-slate-800 pt-2 text-xs lg:mt-3 lg:pt-3 lg:text-sm">
        <span className="text-slate-400">
          Difference{" "}
          <b className="ml-1 text-white">
            {complete ? Math.abs(totals.difference).toFixed(1) : "—"}
          </b>
          {analysis && complete ? (
            <span className="ml-2 text-cyan-300">
              · {(totals.percentageDifference * 100).toFixed(1)}%
            </span>
          ) : null}
        </span>
        <button
          type="button"
          disabled={!complete}
          onClick={analyze}
          className="min-h-10 shrink-0 rounded-lg bg-cyan-400 px-4 py-2 font-black text-slate-950 disabled:opacity-40"
        >
          {analysis ? "Analyzed" : "Analyze Trade"}
        </button>
      </div>
      {!analyticsAvailable && (
        <p className="mt-2 text-xs font-semibold text-amber-300">
          Rosters are available. Analytics are temporarily unavailable, so
          missing values display —.
        </p>
      )}
      {analysis ? (
        <>
          <p className="mt-2 text-xs font-bold text-cyan-100 lg:hidden">
            {describeTradeImpact(
              analysis.myImpact,
              send.length,
              receive.length,
            )}
          </p>
          <details className="mt-2 lg:hidden">
            <summary className="cursor-pointer text-xs font-bold text-slate-400">
              Why this trade?
            </summary>
            <LineupImpact
              myImpact={analysis.myImpact}
              opponentImpact={analysis.opponentImpact}
            />
          </details>
          <div className="hidden lg:block">
        <LineupImpact
          myImpact={analysis.myImpact}
          opponentImpact={analysis.opponentImpact}
        />
          </div>
        </>
      ) : null}
    </section>
  );
}

function SummarySide({
  label,
  players,
  total,
}: {
  label: string;
  players: TradePlayer[];
  total: number | null;
}) {
  return (
    <div>
      <p className="text-[10px] font-black tracking-widest text-cyan-300">
        {label}
      </p>
      <div className="mt-1 flex min-h-6 gap-1 overflow-x-auto text-xs text-slate-200 lg:block lg:space-y-1 lg:overflow-visible lg:text-sm">
        {players.length ? (
          players.map((player) => (
            <TradePackagePlayer key={player.id} player={player} compact />
          ))
        ) : (
          <span className="text-slate-600">Select players</span>
        )}
      </div>
      <p className="mt-1 text-[10px] text-slate-500 lg:text-xs">
        Value <b className="text-white">{total?.toFixed(1) ?? "—"}</b>
      </p>
    </div>
  );
}

function Suggestion({
  suggestion,
  teamName,
}: {
  suggestion: TradeSuggestion;
  teamName: string;
}) {
  const starterDelta = suggestion.myImpact.starterPpgDelta;
  const depthLabel = classifyDepthImpact(suggestion.myImpact);
  const quality =
    suggestion.tradeFairnessScore >= 80
      ? "Strong match"
      : suggestion.tradeFairnessScore >= 65
        ? "Fair match"
        : "Worth exploring";
  return (
    <article className="rounded-2xl border border-slate-800 bg-slate-900/70 p-3 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
        <h3 className="font-black">Trade with {teamName}</h3>
          <p className="mt-0.5 text-xs text-slate-500">
            {suggestion.tradeShape} · {quality}
          </p>
        </div>
        <span className="rounded-full bg-cyan-400/10 px-2.5 py-1 text-xs font-black text-cyan-200">
          Quality {suggestion.tradeFairnessScore.toFixed(0)}
        </span>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <SuggestionSide
          label="YOU SEND"
          value={suggestion.sendValue}
          players={suggestion.send}
        />
        <SuggestionSide
          label="YOU RECEIVE"
          value={suggestion.receiveValue}
          players={suggestion.receive}
        />
      </div>
      <div className="mt-3 rounded-xl border border-slate-800 bg-slate-950/50 p-3">
        <p className="flex items-start gap-2 text-sm font-bold text-slate-100">
          <Sparkles size={16} className="mt-0.5 shrink-0 text-cyan-300" />
          {describeTradeImpact(
            suggestion.myImpact,
            suggestion.send.length,
            suggestion.receive.length,
          )}
        </p>
        <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-bold">
          <span
            className={`rounded-full px-2 py-1 ${starterDelta > 0.05 ? "bg-emerald-400/10 text-emerald-200" : starterDelta < -0.05 ? "bg-rose-400/10 text-rose-200" : "bg-slate-800 text-slate-300"}`}
          >
            {starterDelta >= 0 ? "+" : ""}
            {starterDelta.toFixed(1)} net starting-lineup PPG
          </span>
          <span className="rounded-full bg-slate-800 px-2 py-1 text-slate-300">
            {depthLabel}
          </span>
        </div>
      </div>
      <details className="mt-3 border-t border-slate-800 pt-2">
        <summary className="cursor-pointer text-xs font-bold text-slate-400">
          Why this trade?
        </summary>
        <TradeDifference
          sendValue={suggestion.sendValue}
          receiveValue={suggestion.receiveValue}
        />
        <ul className="mt-2 space-y-1 text-xs text-slate-500">
          {suggestion.reasons.map((reason) => (
            <li key={reason}>• {reason}</li>
          ))}
        </ul>
      <LineupImpact
        myImpact={suggestion.myImpact}
        opponentImpact={suggestion.opponentImpact}
      />
      </details>
    </article>
  );
}

function LineupImpact({
  myImpact,
  opponentImpact,
}: {
  myImpact: TeamTradeImpact;
  opponentImpact: TeamTradeImpact;
}) {
  return (
    <section className="mt-3 border-t border-slate-800 pt-3">
      <h4 className="text-[10px] font-black tracking-[0.16em] text-slate-500 uppercase">
        Lineup impact
      </h4>
      <div className="mt-2 grid gap-3 text-xs sm:grid-cols-2">
        <ImpactSide label="You" impact={myImpact} />
        <ImpactSide label="Opponent" impact={opponentImpact} />
      </div>
    </section>
  );
}

function ImpactSide({
  label,
  impact,
}: {
  label: string;
  impact: TeamTradeImpact;
}) {
  const notes = impact.lineupNotes.slice(0, 4);
  return (
    <div className="rounded-lg bg-slate-950/45 p-2.5">
      <p className="text-slate-400">
        <b className="text-slate-200">{label}</b>{" "}
        <span className="text-cyan-200">
          {impact.starterPpgDelta >= 0 ? "+" : ""}
          {impact.starterPpgDelta.toFixed(1)} net starting-lineup PPG
        </span>
      </p>
      <p className="mt-1 text-slate-400">{describeDepthImpact(impact)}</p>
      <ul className="mt-1.5 space-y-1 text-slate-500">
        {notes.length ? (
          notes.map((note) => <li key={note}>• {note}</li>)
        ) : (
          <li>• Starting lineup unchanged</li>
        )}
      </ul>
    </div>
  );
}

function SuggestionSide({
  label,
  value,
  players,
}: {
  label: string;
  value: number;
  players: TradePlayer[];
}) {
  return (
    <div>
      <p className="text-[10px] font-black tracking-widest text-slate-500">
        {label}
      </p>
      <p className="mt-1 text-xs text-slate-500">
        Selected value <b className="text-white">{value.toFixed(1)}</b>
      </p>
      {players.map((player) => (
        <TradePackagePlayer key={player.id} player={player} />
      ))}
    </div>
  );
}

function TradePackagePlayer({
  player,
  compact = false,
}: {
  player: TradePlayer;
  compact?: boolean;
}) {
  if (compact)
    return (
      <div className="flex shrink-0 items-center gap-1 rounded-full bg-slate-800 px-2 py-1 lg:justify-between lg:rounded-none lg:bg-transparent lg:px-0 lg:py-0">
        <PlayerLink
          playerId={player.id}
          className="max-w-28 truncate font-semibold lg:max-w-none lg:min-w-0"
        >
          {player.name}
        </PlayerLink>
        <span className="font-bold text-cyan-100 tabular-nums">
          {player.value?.toFixed(1) ?? "—"}
        </span>
      </div>
    );
  return (
    <div className="mt-2 grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-2 rounded-xl bg-slate-950/55 p-2">
    <PlayerAvatar name={player.name} headshotUrl={player.headshotUrl} />
    <span className="min-w-0">
        <PlayerLink
          playerId={player.id}
          className="block truncate text-sm font-bold"
        >
          {player.name}
        </PlayerLink>
        <small className="block truncate text-slate-500">
          {player.position ?? "—"} · {player.nflTeam ?? "FA"}
          {player.depthRole ? ` · Depth ${player.depthRole}` : ""}
        </small>
        {player.injuryStatus && !["healthy", "unknown"].includes(player.injuryStatus) ? <small className="block truncate text-amber-300">Availability: {player.injuryStatus.toUpperCase()}{player.injuryTimeline ? ` · ${player.injuryTimeline}` : ""}{player.availabilityAdjustment != null && player.availabilityAdjustment < -0.05 ? ` · Value ${player.availabilityAdjustment.toFixed(1)}` : ""}</small> : null}
        {player.opponent ? (
          <small className="block text-slate-600">
            {player.isHome ? "vs" : "@"} {player.opponent}
          </small>
        ) : null}
    </span>
    <span className="grid grid-cols-2 gap-2 text-right tabular-nums">
      <MetricInline label="VALUE" value={player.value} />
      <MetricInline label="PROJ PPG" value={player.projectedPpg} />
    </span>
    </div>
  );
}

export function TradeDifference({
  sendValue,
  receiveValue,
}: {
  sendValue: number;
  receiveValue: number;
}) {
  const absolute = Math.abs(receiveValue - sendValue);
  const average = Math.max(1, (sendValue + receiveValue) / 2);
  const direction =
    receiveValue > sendValue
      ? "receive side higher"
      : sendValue > receiveValue
        ? "send side higher"
        : "even";
  return (
    <p className="mt-3 border-t border-slate-800 pt-2 text-xs text-slate-400">
      Standalone value difference{" "}
      <b className="text-slate-100">
        {absolute.toFixed(1)} · {((absolute / average) * 100).toFixed(1)}%
      </b>{" "}
      <span className="text-slate-500">({direction})</span>
    </p>
  );
}

function TradeResultsSkeleton() {
  return (
    <div className="animate-pulse rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
      <div className="h-4 w-44 rounded bg-slate-800" />
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="h-20 rounded bg-slate-800/70" />
        <div className="h-20 rounded bg-slate-800/70" />
      </div>
    </div>
  );
}
