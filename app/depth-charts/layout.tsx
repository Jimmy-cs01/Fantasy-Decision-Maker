import { AppShell } from "@/components/dashboard/app-shell";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { publicPageMetadata } from "@/lib/seo/metadata";
export const dynamic = "force-dynamic";
export const metadata = publicPageMetadata("NFL Depth Charts for Fantasy Football", "Explore current offensive NFL depth charts with fantasy football projections, roles, and Player Value context.", "/depth-charts");
export default async function DepthChartsLayout({ children }: { children: React.ReactNode }) {
  if (!isSupabaseConfigured()) return children;
  const db = await createClient(); const { data: { user } } = await db.auth.getUser();
  return <AppShell guest={!user}>{children}</AppShell>;
}
