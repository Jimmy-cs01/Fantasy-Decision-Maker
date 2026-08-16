import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { searchRank } from "@/lib/players/filters";

export async function GET(request: Request) {
  const parsed = z.string().trim().min(2).max(80).safeParse(new URL(request.url).searchParams.get("q"));
  if (!parsed.success) return NextResponse.json({ players: [] });
  const db = await createClient(); const { data: { user } } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const escaped = parsed.data.replaceAll("%", "\\%").replaceAll("_", "\\_");
  const { data, error } = await db.from("players").select("id,full_name,historical_position,sleeper_position,team,rookie_season,sleeper_player_id").ilike("full_name", `%${escaped}%`).limit(30);
  if (error) { console.error("Player search failed", error); return NextResponse.json({ error: "Player search is unavailable." }, { status: 500 }); }
  const players = (data ?? []).sort((a, b) => searchRank(b.full_name, parsed.data, Boolean(b.sleeper_player_id), b.rookie_season) - searchRank(a.full_name, parsed.data, Boolean(a.sleeper_player_id), a.rookie_season) || a.full_name.localeCompare(b.full_name)).slice(0, 10);
  return NextResponse.json({ players });
}
