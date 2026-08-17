"use client";

import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { PlayerAvatar } from "@/components/players/player-avatar";
import { TeamChoiceStrip } from "@/components/trades/team-choice-strip";
import {
  findTradeSuggestions,
  tradeTotals,
  type TradePlayer,
  type TradeSuggestion,
} from "@/lib/trades/engine";

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
}: {
  teams: TradeTeam[];
  rosterPositions: string[];
  analyticsAvailable: boolean;
}) {
  const myTeam = teams.find((team) => team.isMyTeam) ?? teams[0];
  const [mode, setMode] = useState<"manual" | "auto">("manual");
  const [autoMode, setAutoMode] = useState<"specific" | "whole">("specific");
  const [teamAId, setTeamAId] = useState(myTeam?.id ?? "");
  const [teamBId, setTeamBId] = useState(
    teams.find((team) => team.id !== myTeam?.id)?.id ?? "",
  );
  const [sendIds, setSendIds] = useState<string[]>([]);
  const [receiveIds, setReceiveIds] = useState<string[]>([]);
  const [specificPlayerId, setSpecificPlayerId] = useState("");
  const [suggestions, setSuggestions] = useState<TradeSuggestion[]>([]);
  const [isSearching, setIsSearching] = useState(false);
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
  ) =>
    setter(
      values.includes(id)
        ? values.filter((value) => value !== id)
        : [...values, id],
    );
  const runAuto = () => {
    setIsSearching(true);
    window.setTimeout(() => {
      setSuggestions(
        findTradeSuggestions({
          myRoster: myTeam?.players ?? [],
          otherRosters,
          rosterPositions,
          specificPlayerId: autoMode === "specific" ? specificPlayerId : null,
        }),
      );
      setIsSearching(false);
    }, 0);
  };

  if (!myTeam)
    return (
      <p className="rounded-xl border border-dashed border-slate-700 p-5 text-slate-400">
        No synchronized league teams are available.
      </p>
    );
  return (
    <div>
      <SegmentedControl
        items={[
          { id: "manual", label: "Manual Trade" },
          { id: "auto", label: "Find Trades" },
        ]}
        selected={mode}
        onSelect={(id) => setMode(id as "manual" | "auto")}
      />
      {mode === "manual" ? (
        <>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
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
            key={`${sendIds.join("+")}->${receiveIds.join("+")}`}
            send={send}
            receive={receive}
            totals={totals}
            complete={hasCompleteValues}
            analyticsAvailable={analyticsAvailable}
          />
        </>
      ) : (
        <div className="mt-4 space-y-4">
          <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-black">Automatic Trade Finder</h2>
                <p className="mt-1 text-sm text-slate-400">
                  Searches bounded, close-value packages only when you press
                  Find Trades.
                </p>
              </div>
              <SegmentedControl
                items={[
                  { id: "specific", label: "Specific Player" },
                  { id: "whole", label: "Whole Roster" },
                ]}
                selected={autoMode}
                onSelect={(id) => {
                  setAutoMode(id as "specific" | "whole");
                  setSuggestions([]);
                }}
              />
            </div>
            {autoMode === "specific" ? (
              <div className="mt-4 max-w-2xl">
                <RosterSelector
                  players={myTeam.players}
                  selected={specificPlayerId ? [specificPlayerId] : []}
                  onToggle={(id) =>
                    setSpecificPlayerId((current) => (current === id ? "" : id))
                  }
                  single
                />
              </div>
            ) : (
              <p className="mt-4 rounded-xl bg-slate-950/70 p-4 text-sm text-slate-300">
                Search your strongest rostered assets against every other team,
                with positional need and projected starter impact used for
                ranking.
              </p>
            )}
            <button
              type="button"
              disabled={
                !analyticsAvailable ||
                isSearching ||
                (autoMode === "specific" && !specificPlayerId)
              }
              onClick={runAuto}
              className="mt-4 min-h-11 rounded-xl bg-cyan-400 px-5 py-2 font-black text-slate-950 disabled:opacity-40"
            >
              {isSearching
                ? "Searching…"
                : autoMode === "specific"
                  ? `Find Trades${specificPlayerId ? ` for ${myTeam.players.find((player) => player.id === specificPlayerId)?.name ?? "Player"}` : ""}`
                  : "Find Trades for My Roster"}
            </button>
          </section>
          <div aria-live="polite" className="grid gap-3">
            {isSearching ? (
              <TradeResultsSkeleton />
            ) : suggestions.length ? (
              suggestions.map((suggestion) => (
                <Suggestion
                  key={`${suggestion.send.map((player) => player.id).join("+")}->${suggestion.receive.map((player) => player.id).join("+")}`}
                  suggestion={suggestion}
                  teamName={
                    teams.find(
                      (team) => team.id === suggestion.receive[0]?.teamId,
                    )?.name ?? "League team"
                  }
                />
              ))
            ) : (
              <p className="rounded-xl border border-dashed border-slate-700 p-5 text-sm text-slate-400">
                {analyticsAvailable
                  ? "Run a search to generate league-aware candidates."
                  : "Recommendations are temporarily unavailable. Manual roster selection remains available."}
              </p>
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
}: {
  items: Array<{ id: string; label: string }>;
  selected: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="inline-flex rounded-xl bg-slate-900 p-1 text-sm font-bold">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          aria-pressed={selected === item.id}
          onClick={() => onSelect(item.id)}
          className={`rounded-lg px-3 py-2 transition ${selected === item.id ? "bg-cyan-400 text-slate-950" : "text-slate-400 hover:text-white"}`}
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
  single = false,
}: {
  players: TradePlayer[];
  selected: string[];
  onToggle: (id: string) => void;
  single?: boolean;
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
      <div className="mt-2 max-h-[31rem] divide-y divide-slate-800 overflow-y-auto">
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
      {single && (
        <p className="mt-2 text-xs text-slate-500">
          Select one player to anchor every suggested package.
        </p>
      )}
    </>
  );
}

function TradePlayerRow({
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
    <button
      type="button"
      aria-pressed={selected}
      onClick={onToggle}
      className={`grid min-h-[3.75rem] w-full grid-cols-[2.35rem_minmax(0,1fr)_auto] items-center gap-2 rounded-lg px-2 py-2 text-left transition ${selected ? "bg-cyan-400/15 ring-1 ring-cyan-300" : "hover:bg-slate-800/60"}`}
    >
      <PlayerAvatar name={player.name} headshotUrl={player.headshotUrl} />
      <span className="min-w-0">
        <b className="block truncate text-sm text-white">{player.name}</b>
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
    </button>
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
}: {
  send: TradePlayer[];
  receive: TradePlayer[];
  totals: ReturnType<typeof tradeTotals>;
  complete: boolean;
  analyticsAvailable: boolean;
}) {
  const [analyzed, setAnalyzed] = useState(false);
  return (
    <section className="sticky bottom-3 z-10 mt-4 rounded-2xl border border-cyan-400/25 bg-slate-950/95 p-4 shadow-2xl backdrop-blur lg:static">
      <div className="grid gap-4 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
        <SummarySide
          label="YOU SEND"
          players={send}
          total={complete ? totals.sendValue : null}
        />
        <div className="text-center text-xs font-black text-slate-500">FOR</div>
        <SummarySide
          label="YOU RECEIVE"
          players={receive}
          total={complete ? totals.receiveValue : null}
        />
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 pt-3 text-sm">
        <span className="text-slate-400">
          Difference{" "}
          <b className="ml-1 text-white">
            {complete ? Math.abs(totals.difference).toFixed(1) : "—"}
          </b>
          {analyzed && complete ? (
            <span className="ml-2 text-cyan-300">
              · {(totals.percentageDifference * 100).toFixed(1)}%
            </span>
          ) : null}
        </span>
        <button
          type="button"
          disabled={!complete}
          onClick={() => setAnalyzed(true)}
          className="rounded-lg bg-cyan-400 px-4 py-2 font-black text-slate-950 disabled:opacity-40"
        >
          {analyzed ? "Analyzed" : "Analyze Trade"}
        </button>
      </div>
      {!analyticsAvailable && (
        <p className="mt-2 text-xs font-semibold text-amber-300">
          Rosters are available. Analytics are temporarily unavailable, so
          missing values display —.
        </p>
      )}
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
      <div className="mt-1 min-h-6 text-sm text-slate-200">
        {players.length ? (
          players.map((player) => (
            <span key={player.id} className="mr-2 inline-block">
              {player.name} <b>{player.value?.toFixed(1) ?? "—"}</b>
            </span>
          ))
        ) : (
          <span className="text-slate-600">Select players</span>
        )}
      </div>
      <p className="mt-1 text-xs text-slate-500">
        Selected value <b className="text-white">{total?.toFixed(1) ?? "—"}</b>
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
  return (
    <article className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
      <div className="flex justify-between gap-3">
        <h3 className="font-black">Trade with {teamName}</h3>
        <span className="text-sm font-bold text-cyan-300">
          Δ {suggestion.difference >= 0 ? "+" : ""}
          {suggestion.difference.toFixed(1)}
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
      <p className="mt-2 text-xs text-slate-500">
        Projected optimal-lineup impact:{" "}
        {suggestion.lineupDelta >= 0 ? "+" : ""}
        {suggestion.lineupDelta.toFixed(1)} PPG
      </p>
    </article>
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
        {label} · {value.toFixed(1)}
      </p>
      {players.map((player) => (
        <div key={player.id} className="mt-2 flex items-center gap-2">
          <PlayerAvatar name={player.name} headshotUrl={player.headshotUrl} />
          <span className="min-w-0 flex-1">
            <b className="block truncate text-sm">{player.name}</b>
            <small className="text-slate-500">
              {player.position ?? "—"} · {player.nflTeam ?? "FA"}
            </small>
          </span>
          <b className="text-cyan-200">{player.value?.toFixed(1) ?? "—"}</b>
        </div>
      ))}
    </div>
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
