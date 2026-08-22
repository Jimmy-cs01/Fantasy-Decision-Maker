import { AppShell } from "@/components/dashboard/app-shell";
import { createClient } from "@/lib/supabase/server";
import { privatePageMetadata } from "@/lib/seo/metadata";

export const dynamic = "force-dynamic";
export const metadata = privatePageMetadata("League Schedule");
export default async function LeagueMatchupsLayout({ children }: { children: React.ReactNode }) {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  return <AppShell guest={!user}>{children}</AppShell>;
}
