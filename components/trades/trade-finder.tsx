"use client";

import { useMemo, useState } from "react";
import { PlayerAvatar } from "@/components/players/player-avatar";
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
  const [teamAId, setTeamAId] = useState(myTeam?.id ?? "");
  const [teamBId, setTeamBId] = useState(
    teams.find((team) => team.id !== myTeam?.id)?.id ?? "",
  );
  const [sendIds, setSendIds] = useState<string[]>([]);
  const [receiveIds, setReceiveIds] = useState<string[]>([]);
  const [specificPlayerId, setSpecificPlayerId] = useState("");
  const [suggestions, setSuggestions] = useState<TradeSuggestion[]>([]);
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
  const otherRosters = useMemo(
    () =>
      teams
        .filter((team) => team.id !== myTeam?.id)
        .map((team) => team.players),
    [teams, myTeam?.id],
  );
  const runAuto = (specific: boolean) =>
    setSuggestions(
      findTradeSuggestions({
        myRoster: myTeam?.players ?? [],
        otherRosters,
        rosterPositions,
        specificPlayerId: specific ? specificPlayerId : null,
      }),
    );

  if (!myTeam)
    return (
      <p className="rounded-xl border border-dashed border-slate-700 p-5 text-slate-400">
        No synchronized league teams are available.
      </p>
    );
  return (
    <div>
      <div className="inline-flex rounded-xl bg-slate-900 p-1 text-sm font-bold">
        <button
          onClick={() => setMode("manual")}
          className={`rounded-lg px-4 py-2 ${mode === "manual" ? "bg-cyan-400 text-slate-950" : "text-slate-400"}`}
        >
          Manual Trade
        </button>
        <button
          onClick={() => setMode("auto")}
          className={`rounded-lg px-4 py-2 ${mode === "auto" ? "bg-cyan-400 text-slate-950" : "text-slate-400"}`}
        >
          Auto Finder
        </button>
      </div>
      {mode === "manual" ? (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <TradeSide
            label="Team A sends"
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
            label="Team B sends"
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
          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 lg:col-span-2">
            <h2 className="font-black">Trade analysis</h2>
            <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <Metric
                label="Team A sends"
                value={hasCompleteValues ? totals.sendValue : null}
              />
              <Metric
                label="Team B sends"
                value={hasCompleteValues ? totals.receiveValue : null}
              />
              <Metric
                label="Difference"
                value={hasCompleteValues ? Math.abs(totals.difference) : null}
              />
              <Metric
                label="Percentage difference"
                value={
                  hasCompleteValues ? totals.percentageDifference * 100 : null
                }
                suffix="%"
              />
            </div>
            <p className="mt-3 text-xs text-slate-500">
              Value totals are a comparison tool, not an objective verdict.
              League scoring and replacement context are already included in
              each player value.
            </p>
            {!analyticsAvailable && (
              <p className="mt-2 text-xs font-semibold text-amber-300">
                Rosters loaded successfully. Values and recommendations are
                temporarily unavailable; manual player selection remains
                available.
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
            <h2 className="font-black">Automatic Trade Finder</h2>
            <p className="mt-1 text-sm text-slate-400">
              Searches close-value 1-for-1, 2-for-1, 1-for-2, and 2-for-2
              packages across this league.
            </p>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <select
                value={specificPlayerId}
                onChange={(event) => setSpecificPlayerId(event.target.value)}
                className="min-h-11 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3"
              >
                <option value="">Choose one of your players</option>
                {myTeam.players.map((player) => (
                  <option key={player.id} value={player.id}>
                    {player.name} · {player.position} ·{" "}
                    {player.value?.toFixed(1) ?? "—"}
                  </option>
                ))}
              </select>
              <button
                disabled={!specificPlayerId || !analyticsAvailable}
                onClick={() => runAuto(true)}
                className="rounded-lg bg-cyan-400 px-4 py-2 font-black text-slate-950 disabled:opacity-40"
              >
                Find for Player
              </button>
              <button
                disabled={!analyticsAvailable}
                onClick={() => runAuto(false)}
                className="rounded-lg border border-cyan-400 px-4 py-2 font-black text-cyan-200 disabled:opacity-40"
              >
                Search Whole Roster
              </button>
            </div>
          </div>
          <div className="grid gap-3">
            {suggestions.length ? (
              suggestions.map((suggestion) => (
                <Suggestion
                  key={
                    suggestion.send.map((player) => player.id).join("+") +
                    suggestion.receive.map((player) => player.id).join("+")
                  }
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
                  : "Trade recommendations are temporarily unavailable. Manual roster selection is still available."}
              </p>
            )}
          </div>
        </div>
      )}
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
    <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-3">
      <label className="text-xs font-black tracking-wider text-cyan-300 uppercase">
        {label}
        <select
          value={teamId}
          onChange={(event) => setTeamId(event.target.value)}
          className="mt-2 block min-h-11 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-white"
        >
          {teams
            .filter((item) => item.id !== disabledTeamId)
            .map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
        </select>
      </label>
      <div className="mt-3 max-h-[30rem] divide-y divide-slate-800 overflow-y-auto">
        {team?.players.map((player) => (
          <label
            key={player.id}
            className="grid cursor-pointer grid-cols-[1.25rem_2.25rem_minmax(0,1fr)_3rem] items-center gap-2 py-2"
          >
            <input
              type="checkbox"
              checked={selected.includes(player.id)}
              onChange={() => toggle(player.id)}
              className="size-4 accent-cyan-400"
            />
            <PlayerAvatar name={player.name} headshotUrl={player.headshotUrl} />
            <span className="min-w-0">
              <b className="block truncate text-sm">{player.name}</b>
              <small className="text-slate-500">
                {player.nflTeam ?? "FA"} · {player.position ?? "—"} ·{" "}
                {player.projectedPpg?.toFixed(1) ?? "—"} PPG
              </small>
            </span>
            <b className="text-right text-cyan-200">
              {player.value?.toFixed(1) ?? "—"}
            </b>
          </label>
        ))}
      </div>
    </section>
  );
}

function Metric({
  label,
  value,
  suffix = "",
}: {
  label: string;
  value: number | null;
  suffix?: string;
}) {
  return (
    <div className="rounded-lg bg-slate-950 p-3">
      <span className="block text-xs text-slate-500">{label}</span>
      <b>{value === null ? "—" : value.toFixed(1) + suffix}</b>
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
      <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <p className="text-xs font-black text-slate-500">
            YOU SEND · {suggestion.sendValue.toFixed(1)}
          </p>
          {suggestion.send.map((player) => (
            <p key={player.id}>
              {player.name}{" "}
              <b className="text-cyan-200">{player.value?.toFixed(1)}</b>
            </p>
          ))}
        </div>
        <div>
          <p className="text-xs font-black text-slate-500">
            YOU RECEIVE · {suggestion.receiveValue.toFixed(1)}
          </p>
          {suggestion.receive.map((player) => (
            <p key={player.id}>
              {player.name}{" "}
              <b className="text-cyan-200">{player.value?.toFixed(1)}</b>
            </p>
          ))}
        </div>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        Projected optimal-lineup impact:{" "}
        {suggestion.lineupDelta >= 0 ? "+" : ""}
        {suggestion.lineupDelta.toFixed(1)} PPG
      </p>
    </article>
  );
}
