import { AppShell } from "@/components/dashboard/app-shell";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { publicPageMetadata } from "@/lib/seo/metadata";

export const dynamic = "force-dynamic";
export const metadata = publicPageMetadata("Fantasy Football Start/Sit Tool", "Compare players with JimmyGM weekly projections, injury availability, league scoring, and roster-aware Start/Sit analysis.", "/start-sit");

export default async function StartSitLayout({ children }: { children: React.ReactNode }) {
  if (!isSupabaseConfigured()) return <AppShell guest>{children}</AppShell>;
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  return <AppShell guest={!user}>{children}</AppShell>;
}
