import { AppShell } from "@/components/dashboard/app-shell";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { publicPageMetadata } from "@/lib/seo/metadata";

export const dynamic = "force-dynamic";
export const metadata = publicPageMetadata("Fantasy Football Matchups", "Review weekly NFL matchups, game context, team depth charts, and market-informed fantasy football projections.", "/matchups");
export default async function MatchupsLayout({ children }: { children: React.ReactNode }) {
  if (!isSupabaseConfigured()) return children;
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  return <AppShell guest={!user}>{children}</AppShell>;
}
