import { publicPageMetadata } from "@/lib/seo/metadata";
import { AppShell } from "@/components/dashboard/app-shell";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = publicPageMetadata("Fantasy Football Projections & Player Values", "Explore weekly fantasy football projections, injury-adjusted PPG, player values, position rankings, and historical NFL performance.", "/players");

export default async function PlayersLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!isSupabaseConfigured()) return children;
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  return <AppShell guest={!user}>{children}</AppShell>;
}
