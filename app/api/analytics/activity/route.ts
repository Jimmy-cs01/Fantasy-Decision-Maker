import { NextResponse } from "next/server";
import { z } from "zod";
import { featureForPath, normalizedAuthenticatedPath } from "@/lib/analytics/features";
import { normalizedAnonymousPath } from "@/lib/analytics/guest";
import { recordAnonymousActivity } from "@/lib/analytics/record-anonymous";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const payload = z.object({
  anonymousId: z.string().uuid(),
  sessionId: z.string().uuid(),
  path: z.string().max(300).regex(/^\//),
  visitorType: z.enum(["guest", "anonymous"]),
});

export async function POST(request: Request) {
  const parsed = payload.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid analytics event." }, { status: 400 });
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();

  if (user && user.is_anonymous !== true) {
    const admin = createAdminClient();
    const path = normalizedAuthenticatedPath(parsed.data.path);
    const { error } = await admin.rpc("record_authenticated_activity", {
      account_id: user.id,
      browser_session_id: parsed.data.sessionId,
      visited_path: path,
      visited_feature: featureForPath(path),
    });
    if (error) {
      if (error.code === "PGRST202" || error.code === "42883") {
        console.warn("Authenticated analytics migration is not applied yet.");
        return new NextResponse(null, { status: 204 });
      }
      console.error("Authenticated analytics ingestion failed", error);
      return NextResponse.json({ error: "Analytics event unavailable." }, { status: 503 });
    }
    return new NextResponse(null, { status: 204 });
  }

  const error = await recordAnonymousActivity({
    anonymousId: parsed.data.anonymousId,
    sessionId: parsed.data.sessionId,
    path: normalizedAnonymousPath(parsed.data.path),
    visitorType: parsed.data.visitorType,
  });
  if (error) {
    console.error("Guest analytics ingestion failed", error);
    return NextResponse.json({ error: "Analytics event unavailable." }, { status: 503 });
  }
  return new NextResponse(null, { status: 204 });
}
