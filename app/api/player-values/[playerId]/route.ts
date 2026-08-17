import { NextResponse } from "next/server";
import { z } from "zod";
import { getPlayerValue } from "@/lib/player-values/service";

export async function GET(request: Request, context: { params: Promise<{ playerId: string }> }) {
  const { playerId } = await context.params;
  const leagueId = new URL(request.url).searchParams.get("leagueId") ?? undefined;
  if (!z.string().uuid().safeParse(playerId).success || (leagueId && !z.string().uuid().safeParse(leagueId).success)) {
    return NextResponse.json({ error: "Invalid player value request." }, { status: 400 });
  }
  try {
    const value = await getPlayerValue(playerId, leagueId);
    if (!value) return NextResponse.json({ error: "Player value unavailable." }, { status: 404 });
    return NextResponse.json({ value });
  } catch (error) {
    console.error("Player Value API failed", error);
    const forbidden = error instanceof Error && error.message === "Selected league is unavailable.";
    return NextResponse.json({ error: forbidden ? error.message : "Player value is unavailable." }, { status: forbidden ? 403 : 500 });
  }
}
