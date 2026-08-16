"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { sleeperClient } from "@/lib/sleeper/client";
import { synchronizeLeague } from "@/lib/db/sync-league";

async function getSession() { const db = await createClient(); const { data: { user } } = await db.auth.getUser(); if (!user) redirect("/auth"); return { db, user }; }
export async function importLeague(formData: FormData) { const parsed = z.object({ username: z.string().min(1).max(64), leagueId: z.string().min(1).max(64) }).safeParse(Object.fromEntries(formData)); if (!parsed.success) redirect("/dashboard/connect?error=Invalid+league+selection."); const { db, user } = await getSession(); const sleeperUser = await sleeperClient.getUser(parsed.data.username); if (!sleeperUser) redirect("/dashboard/connect?error=Sleeper+user+was+not+found."); try { const league = await synchronizeLeague(db, user.id, sleeperUser, parsed.data.leagueId); revalidatePath("/dashboard"); redirect(`/dashboard/league/${league.id}`); } catch (error) { console.error("League import failed", error); redirect("/dashboard/connect?error=Could+not+import+league.+Please+try+again."); } }
export async function syncLeague(formData: FormData) { const parsed = z.object({ leagueId: z.string().uuid() }).safeParse(Object.fromEntries(formData)); if (!parsed.success) return; const { db, user } = await getSession(); const { data: league } = await db.from("leagues").select("sleeper_league_id").eq("id", parsed.data.leagueId).eq("owner_id", user.id).single(); const { data: account } = await db.from("sleeper_accounts").select("username").eq("user_id", user.id).limit(1).single(); if (!league || !account) return; const sleeperUser = await sleeperClient.getUser(account.username); if (!sleeperUser) return; try { await synchronizeLeague(db, user.id, sleeperUser, league.sleeper_league_id); } catch (error) { console.error("League synchronization failed", error); } revalidatePath(`/dashboard/league/${parsed.data.leagueId}`); revalidatePath("/dashboard"); }
