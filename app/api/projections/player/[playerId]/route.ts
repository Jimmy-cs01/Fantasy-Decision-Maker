import { NextResponse } from "next/server";
import { z } from "zod";
import { getPlayerProjection } from "@/lib/projections/service";

const querySchema = z.object({
  season: z.coerce.number().int().min(2012).max(2100).optional(),
  week: z.coerce.number().int().min(1).max(25).optional(),
  leagueId: z.string().uuid().optional(),
  scoring: z.enum(["league", "standard", "half_ppr", "ppr"]).optional(),
});

export async function GET(request: Request, context: { params: Promise<{ playerId: string }> }) {
  const { playerId } = await context.params;
  if (!z.string().uuid().safeParse(playerId).success) {
    return NextResponse.json({ error: "Invalid player ID." }, { status: 400 });
  }
  const url = new URL(request.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return NextResponse.json({ error: "Invalid projection filters." }, { status: 400 });
  try {
    const projection = await getPlayerProjection(playerId, parsed.data);
    if (!projection) return NextResponse.json({ error: "Projection not found." }, { status: 404 });
    return NextResponse.json({ projection });
  } catch (error) {
    console.error("Projection API failed", error);
    const message = error instanceof Error && error.message === "Selected league is unavailable."
      ? error.message
      : "Projection is unavailable.";
    return NextResponse.json({ error: message }, { status: message.startsWith("Selected") ? 403 : 500 });
  }
}

