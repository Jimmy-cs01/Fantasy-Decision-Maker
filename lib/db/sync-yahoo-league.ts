import "server-only";
import { YahooFantasyClient } from "@/lib/yahoo/client";
import { normalizeYahooLeagues, normalizeYahooRoster, normalizeYahooSettings, normalizeYahooTeams } from "@/lib/yahoo/normalize";
import { createAdminClient } from "@/lib/supabase/admin";

type Database = any;
const ensure = (error: { message: string } | null) => { if (error) throw new Error(error.message); };
const nameKey = (value: string) => value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();

function slotIndexes(players: ReturnType<typeof normalizeYahooRoster>, positions: string[]) {
  const remaining = [...players]; const indexes = new Map<string, number>();
  let index = 0;
  for (const slot of positions) {
    if (["BN", "IR"].includes(slot)) continue;
    const match = remaining.findIndex((player) => player.isStarter && player.selectedPosition === slot);
    if (match >= 0) { const [player] = remaining.splice(match, 1); indexes.set(player.playerKey, index); }
    index += 1;
  }
  return indexes;
}

export async function synchronizeYahooLeague(db: Database, ownerId: string, leagueKey: string) {
  const yahoo = new YahooFantasyClient(ownerId);
  const admin = createAdminClient();
  const { data: yahooAccount } = await admin.from("yahoo_accounts").select("provider_user_id").eq("user_id", ownerId).limit(1).maybeSingle();
  const [leaguePayload, settingsPayload, teamsPayload] = await Promise.all([
    yahoo.getLeague(leagueKey), yahoo.getLeagueSettings(leagueKey), yahoo.getLeagueTeams(leagueKey),
  ]);
  const league = normalizeYahooLeagues(leaguePayload).find((candidate) => candidate.leagueKey === leagueKey);
  if (!league) throw new Error("Yahoo returned malformed league data.");
  const settings = normalizeYahooSettings(settingsPayload); const remoteTeams = normalizeYahooTeams(teamsPayload);
  const { data: localLeague, error: leagueError } = await db.from("leagues").upsert({
    owner_id: ownerId, provider: "yahoo", external_league_id: league.leagueKey, sleeper_league_id: null,
    name: league.name, season: league.season, sport: "nfl", total_rosters: league.numTeams,
    scoring_settings: settings.scoringSettings, roster_positions: settings.rosterPositions,
    provider_metadata: { scoring_type: league.scoringType, unsupported_scoring: settings.unsupportedScoring, raw: league.raw },
    last_synced_at: new Date().toISOString(),
  }, { onConflict: "owner_id,provider,external_league_id" }).select().single(); ensure(leagueError);
  const { data: sync } = await db.from("synchronization_records").insert({ league_id: localLeague.id, initiated_by: ownerId, source: "yahoo", status: "started" }).select().single();
  try {
    const members = remoteTeams.map((team) => ({ league_id: localLeague.id, provider_member_id: team.managerId ?? `team:${team.teamKey}`, sleeper_user_id: null, username: null, display_name: team.managerName, provider_metadata: {} }));
    ensure((await db.from("league_members").upsert(members, { onConflict: "league_id,provider_member_id" })).error);
    const { data: localMembers, error: membersError } = await db.from("league_members").select("id,provider_member_id").eq("league_id", localLeague.id); ensure(membersError);
    const memberIds = new Map(localMembers.map((member: any) => [member.provider_member_id, member.id]));
    const teamRows = remoteTeams.map((team) => ({ league_id: localLeague.id, provider_team_id: team.teamKey, sleeper_roster_id: null,
      league_member_id: memberIds.get(team.managerId ?? `team:${team.teamKey}`) ?? null, name: team.name, wins: team.wins, losses: team.losses, ties: team.ties, provider_metadata: { yahoo_team_id: team.teamId, is_user_team: Boolean(team.managerId && team.managerId === yahooAccount?.provider_user_id) } }));
    ensure((await db.from("fantasy_teams").upsert(teamRows, { onConflict: "league_id,provider_team_id" })).error);
    const { data: localTeams, error: teamsError } = await db.from("fantasy_teams").select("id,provider_team_id").eq("league_id", localLeague.id); ensure(teamsError);

    const rosters = await Promise.all(remoteTeams.map(async (team) => ({ team, players: normalizeYahooRoster(await yahoo.getTeamRoster(team.teamKey)) })));
    const allYahooIds = rosters.flatMap(({ players }) => players.map((player) => player.playerId));
    const [{ data: knownIds }, { data: canonicalPlayers }] = await Promise.all([
      admin.from("player_provider_ids").select("player_id,external_player_id").eq("provider", "yahoo").in("external_player_id", allYahooIds),
      admin.from("players").select("id,full_name,position,team").in("position", ["QB", "RB", "WR", "TE", "K", "DEF"]),
    ]);
    const canonicalByYahoo = new Map((knownIds ?? []).map((row) => [row.external_player_id, row.player_id]));
    const canonicalByName = new Map<string, any[]>();
    for (const player of canonicalPlayers ?? []) { const key = nameKey(player.full_name); canonicalByName.set(key, [...(canonicalByName.get(key) ?? []), player]); }
    let unmapped = 0;
    for (const { team, players } of rosters) {
      const localTeam = localTeams.find((row: any) => row.provider_team_id === team.teamKey); if (!localTeam) continue;
      const indexes = slotIndexes(players, settings.rosterPositions);
      const mapped: Array<{ remote: typeof players[number]; playerId: string }> = [];
      for (const remote of players) {
        let playerId = canonicalByYahoo.get(remote.playerId);
        if (!playerId) {
          const candidates = (canonicalByName.get(nameKey(remote.name)) ?? []).filter((candidate) => !remote.position || candidate.position === remote.position);
          const teamMatches = candidates.filter((candidate) => !remote.team || candidate.team === remote.team);
          const confident = teamMatches.length === 1 ? teamMatches[0] : candidates.length === 1 ? candidates[0] : null;
          if (confident) {
            playerId = confident.id;
            const { error } = await admin.from("player_provider_ids").upsert({ player_id: playerId, provider: "yahoo", external_player_id: remote.playerId, metadata: { player_key: remote.playerKey, match_method: "exact_name_position" } }, { onConflict: "provider,external_player_id" });
            if (!error) canonicalByYahoo.set(remote.playerId, playerId);
          }
        }
        if (playerId) mapped.push({ remote, playerId }); else unmapped += 1;
      }
      const starters = players.filter((player) => player.isStarter).sort((left, right) => (indexes.get(left.playerKey) ?? 999) - (indexes.get(right.playerKey) ?? 999)).map((player) => player.playerKey);
      const reserve = players.filter((player) => !player.isStarter).map((player) => player.playerKey);
      const { data: roster, error: rosterError } = await db.from("rosters").upsert({ fantasy_team_id: localTeam.id, starters, reserve }, { onConflict: "fantasy_team_id" }).select().single(); ensure(rosterError);
      ensure((await db.from("roster_players").delete().eq("roster_id", roster.id)).error);
      if (mapped.length) ensure((await db.from("roster_players").insert(mapped.map(({ remote, playerId }) => ({ roster_id: roster.id, player_id: playerId, is_starter: remote.isStarter, roster_slot: remote.selectedPosition, roster_slot_index: indexes.get(remote.playerKey) ?? null })))).error);
    }
    await db.from("leagues").update({ last_synced_at: new Date().toISOString() }).eq("id", localLeague.id);
    if (sync?.id) await db.from("synchronization_records").update({ status: "completed", completed_at: new Date().toISOString(), details: { unmapped_players: unmapped } }).eq("id", sync.id);
    return localLeague;
  } catch (error) {
    if (sync?.id) await db.from("synchronization_records").update({ status: "failed", completed_at: new Date().toISOString(), details: { error: error instanceof Error ? error.message : "unknown" } }).eq("id", sync.id);
    throw error;
  }
}
