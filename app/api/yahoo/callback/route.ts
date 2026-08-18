import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { exchangeYahooCode, saveYahooAccount } from "@/lib/yahoo/oauth";
import { isValidYahooOAuthState } from "@/lib/yahoo/state";

export async function GET(request: Request) {
  const url = new URL(request.url); const origin = process.env.NEXT_PUBLIC_SITE_URL ?? url.origin;
  const finish = (path: string) => { const response = NextResponse.redirect(new URL(path, origin)); response.cookies.delete("yahoo_oauth_state"); return response; };
  const db = await createClient(); const { data: { user } } = await db.auth.getUser();
  const state = url.searchParams.get("state"); const expected = (await cookies()).get("yahoo_oauth_state")?.value ?? null;
  if (!user || !isValidYahooOAuthState(state, expected)) return finish("/dashboard/connect?yahoo=invalid-state");
  if (url.searchParams.get("error")) return finish("/dashboard/connect?yahoo=denied");
  const code = url.searchParams.get("code");
  if (!code) return finish("/dashboard/connect?yahoo=missing-code");
  try { await saveYahooAccount(user.id, await exchangeYahooCode(code)); return finish("/dashboard/connect?yahoo=connected"); }
  catch (error) { console.error("Yahoo OAuth callback failed", error); return finish("/dashboard/connect?yahoo=failed"); }
}
