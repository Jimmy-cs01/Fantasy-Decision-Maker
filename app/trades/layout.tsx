import { AppShell } from "@/components/dashboard/app-shell";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { publicPageMetadata } from "@/lib/seo/metadata";

export const dynamic = "force-dynamic";
export const metadata = publicPageMetadata("Fantasy Football Trade Finder & Analyzer", "Analyze fantasy football trades using projected starter impact, Player Values, roster depth, positional needs, and league context.", "/trades");

export default async function TradesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!isSupabaseConfigured()) return <AppShell guest>{children}</AppShell>;
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  return <AppShell guest={!user}>{children}</AppShell>;
}
