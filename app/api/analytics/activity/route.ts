import { NextResponse } from "next/server";
import { z } from "zod";
import { featureForPath, normalizedAuthenticatedPath } from "@/lib/analytics/features";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const payload = z.object({
  anonymousId: z.string().uuid(),
  sessionId: z.string().uuid(),
  path: z.string().max(300).regex(/^\//),
});

export async function POST(request: Request) {
  const parsed = payload.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid analytics event." }, { status: 400 });
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  const admin = createAdminClient();

  if (user && user.is_anonymous !== true) {
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

  const { error } = await admin.rpc("record_guest_activity", {
    browser_id: parsed.data.anonymousId,
    browser_session_id: parsed.data.sessionId,
    visited_path: parsed.data.path,
  });
  if (error) {
    console.error("Guest analytics ingestion failed", error);
    return NextResponse.json({ error: "Analytics event unavailable." }, { status: 503 });
  }
  return new NextResponse(null, { status: 204 });
}
