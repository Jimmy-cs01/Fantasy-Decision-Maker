import { NextResponse } from "next/server";
import { z } from "zod";
import { loadGuestLeague } from "@/lib/guest/league";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ leagueId: string }> },
) {
  const { leagueId } = await params;
  const parsed = z.object({
    username: z.string().trim().min(1).max(64),
    leagueId: z.string().trim().min(1).max(64),
  }).safeParse({
    username: new URL(request.url).searchParams.get("username"),
    leagueId,
  });
  if (!parsed.success) return NextResponse.json({ error: "Invalid guest league request." }, { status: 400 });
  try {
    return NextResponse.json(await loadGuestLeague(parsed.data.username, parsed.data.leagueId));
  } catch (error) {
    console.warn("Guest Sleeper league load failed", {
      leagueId: parsed.data.leagueId,
      error: error instanceof Error ? error.message : String(error),
    });
    const message = error instanceof Error ? error.message : "Guest league data is unavailable.";
    const status = message.includes("not found") || message.includes("not connected") ? 404 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
