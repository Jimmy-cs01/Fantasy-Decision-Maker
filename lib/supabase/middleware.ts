import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isSupabaseConfigured } from "./server";

export async function updateSession(request: NextRequest) {
  if (!isSupabaseConfigured()) return NextResponse.next({ request });
  let response = NextResponse.next({ request });
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { cookies: { getAll: () => request.cookies.getAll(), setAll: (entries) => { entries.forEach(({ name, value }) => request.cookies.set(name, value)); response = NextResponse.next({ request }); entries.forEach(({ name, value, options }) => response.cookies.set(name, value, options)); } } });
  await supabase.auth.getUser(); return response;
}
