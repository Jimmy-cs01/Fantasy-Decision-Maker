import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncSleeperInjuries } from "@/lib/injuries/sync";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await syncSleeperInjuries(createAdminClient()));
  } catch (error) {
    console.error("Sleeper injury refresh failed", error);
    return NextResponse.json({ error: "Injury refresh failed." }, { status: 500 });
  }
}
