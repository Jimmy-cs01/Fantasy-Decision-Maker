import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export function isSupabaseConfigured() { return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY); }

export async function createClient() {
  if (!isSupabaseConfigured()) throw new Error("Supabase is not configured. Copy .env.example to .env.local and add your project credentials.");
  const store = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { cookies: { getAll: () => store.getAll(), setAll: (entries) => { try { entries.forEach(({ name, value, options }) => store.set(name, value, options)); } catch { /* Server Component cookie writes are intentionally ignored. */ } } } });
}
