import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { YahooFantasyProvider } from "@/lib/yahoo/provider";

export async function GET() {
  const db = await createClient(); const { data: { user } } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to connect Yahoo." }, { status: 401 });
  try { return NextResponse.json({ leagues: await new YahooFantasyProvider(user.id).getLeagues() }); }
  catch (error) { const message = error instanceof Error ? error.message : "Yahoo is unavailable."; return NextResponse.json({ error: message }, { status: message.includes("Reconnect") ? 401 : 502 }); }
}
