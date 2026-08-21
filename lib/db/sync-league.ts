import { sleeperClient } from "@/lib/sleeper/client";
import { normalizeLeague, normalizeRoster, normalizeSleeperAccount, normalizeSleeperPlayer } from "@/lib/sleeper/service";
import type { SleeperUser } from "@/lib/sleeper/types";
import { assignStarterSlots } from "@/lib/fantasy/roster-order";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncSleeperInjuries } from "@/lib/injuries/sync";

type Database = any;
const ensure = (error: { message: string } | null) => { if (error) throw new Error(error.message); };

export async function synchronizeLeague(db: Database, ownerId: string, sleeperUser: SleeperUser, sleeperLeagueId: string) {
  const [league, users, sleeperRosters, allPlayers] = await Promise.all([sleeperClient.getLeague(sleeperLeagueId), sleeperClient.getLeagueUsers(sleeperLeagueId), sleeperClient.getRosters(sleeperLeagueId), sleeperClient.getPlayers()]);
  const { data: localLeague, error: leagueError } = await db.from("leagues").upsert({ ...normalizeLeague(league), provider: "sleeper", external_league_id: league.league_id, owner_id: ownerId, last_synced_at: new Date().toISOString() }, { onConflict: "owner_id,provider,external_league_id" }).select().single(); ensure(leagueError);
  const { data: sync, error: syncError } = await db.from("synchronization_records").insert({ league_id: localLeague.id, initiated_by: ownerId, status: "started" }).select().single();
  if (!sync || syncError) { /* records are diagnostic; data import remains authoritative */ }
  ensure((await db.from("sleeper_accounts").upsert({ ...normalizeSleeperAccount(sleeperUser), user_id: ownerId }, { onConflict: "user_id,sleeper_user_id" })).error);
  const members = users.map((user) => ({ league_id: localLeague.id, provider_member_id: user.user_id, sleeper_user_id: user.user_id, username: user.username, display_name: user.display_name ?? null, avatar_id: user.avatar ?? null }));
  ensure((await db.from("league_members").upsert(members, { onConflict: "league_id,sleeper_user_id" })).error);
  const { data: localMembers, error: membersError } = await db.from("league_members").select("id,sleeper_user_id").eq("league_id", localLeague.id); ensure(membersError);
  const memberBySleeperId = new Map(localMembers.map((m: any) => [m.sleeper_user_id, m.id]));
  const teams = sleeperRosters.map((r) => { const n = normalizeRoster(r); return { league_id: localLeague.id, league_member_id: r.owner_id ? memberBySleeperId.get(r.owner_id) ?? null : null, provider_team_id: String(n.sleeper_roster_id), sleeper_roster_id: n.sleeper_roster_id, name: n.name, wins: n.wins, losses: n.losses, ties: n.ties }; });
  ensure((await db.from("fantasy_teams").upsert(teams, { onConflict: "league_id,sleeper_roster_id" })).error);
  const { data: localTeams, error: teamsError } = await db.from("fantasy_teams").select("id,sleeper_roster_id").eq("league_id", localLeague.id); ensure(teamsError);
  for (const remoteRoster of sleeperRosters) { const team = localTeams.find((t: any) => t.sleeper_roster_id === remoteRoster.roster_id); if (!team) continue; const n = normalizeRoster(remoteRoster); const assignments = assignStarterSlots(n.starter_entries, league.roster_positions ?? []); const { data: roster, error } = await db.from("rosters").upsert({ fantasy_team_id: team.id, starters: n.starter_entries, reserve: n.reserve }, { onConflict: "fantasy_team_id" }).select().single(); ensure(error); ensure((await db.from("roster_players").delete().eq("roster_id", roster.id)).error); const remotePlayers = n.players.map((id) => allPlayers[id]).filter(Boolean).map(normalizeSleeperPlayer); if (remotePlayers.length) { ensure((await db.from("players").upsert(remotePlayers, { onConflict: "sleeper_player_id" })).error); const { data: localPlayers, error: playersError } = await db.from("players").select("id,sleeper_player_id").in("sleeper_player_id", remotePlayers.map((p) => p.sleeper_player_id)); ensure(playersError); ensure((await db.from("roster_players").insert(localPlayers.map((p: any) => { const assignment = assignments.get(p.sleeper_player_id); return { roster_id: roster.id, player_id: p.id, is_starter: Boolean(assignment), roster_slot: assignment?.rosterSlot ?? "BN", roster_slot_index: assignment?.rosterSlotIndex ?? null }; }))).error); } }
  await db.from("leagues").update({ last_synced_at: new Date().toISOString() }).eq("id", localLeague.id);
  if (sync?.id) await db.from("synchronization_records").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", sync.id);
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try { await syncSleeperInjuries(createAdminClient(), allPlayers); }
    catch (error) { console.warn("League sync completed, but injury refresh failed", error); }
  }
  return localLeague;
}
