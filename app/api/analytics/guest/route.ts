import { NextResponse } from "next/server";
import { z } from "zod";
import { recordAnonymousActivity } from "@/lib/analytics/record-anonymous";
import { normalizedAnonymousPath } from "@/lib/analytics/guest";
import { createClient } from "@/lib/supabase/server";

const payload = z.object({
  anonymousId: z.string().uuid(),
  sessionId: z.string().uuid(),
  path: z.string().max(300).regex(/^\//).optional(),
  visitorType: z.enum(["guest", "anonymous"]).default("guest"),
});

export async function POST(request: Request) {
  const parsed = payload.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid analytics event." }, { status: 400 });
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (user) return new NextResponse(null, { status: 204 });
  const error = await recordAnonymousActivity({
    anonymousId: parsed.data.anonymousId,
    sessionId: parsed.data.sessionId,
    path: parsed.data.path ? normalizedAnonymousPath(parsed.data.path) : null,
    visitorType: parsed.data.visitorType,
  });
  if (error) {
    console.error("Guest analytics ingestion failed", error);
    return NextResponse.json({ error: "Analytics event unavailable." }, { status: 503 });
  }
  return new NextResponse(null, { status: 204 });
}
