import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const payload = z.object({
  anonymousId: z.string().uuid(),
  sessionId: z.string().uuid(),
  path: z.string().max(300).regex(/^\//).optional(),
});

export async function POST(request: Request) {
  const parsed = payload.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid analytics event." }, { status: 400 });
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (user) return new NextResponse(null, { status: 204 });
  const admin = createAdminClient();
  const { error } = await admin.rpc("record_guest_activity", {
    browser_id: parsed.data.anonymousId,
    browser_session_id: parsed.data.sessionId,
    visited_path: parsed.data.path ?? null,
  });
  if (error) {
    console.error("Guest analytics ingestion failed", error);
    return NextResponse.json({ error: "Analytics event unavailable." }, { status: 503 });
  }
  return new NextResponse(null, { status: 204 });
}
