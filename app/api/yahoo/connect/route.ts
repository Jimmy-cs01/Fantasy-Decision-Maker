import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { yahooAuthorizationUrl } from "@/lib/yahoo/oauth";

export async function GET() {
  const db = await createClient(); const { data: { user } } = await db.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login?next=/dashboard/connect", process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"));
  try {
    const state = randomBytes(32).toString("base64url");
    const response = NextResponse.redirect(yahooAuthorizationUrl(state));
    response.cookies.set("yahoo_oauth_state", state, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 600, path: "/api/yahoo/callback" });
    return response;
  } catch (error) {
    console.error("Yahoo connection could not start", error);
    return NextResponse.redirect(new URL("/dashboard/connect?yahoo=not-configured", process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"));
  }
}
