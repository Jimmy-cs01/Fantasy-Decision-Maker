import { redirect } from "next/navigation";
import { AppShell } from "@/components/dashboard/app-shell";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { privatePageMetadata } from "@/lib/seo/metadata";

export const dynamic = "force-dynamic";
export const metadata = privatePageMetadata("Season Outlook");

export default async function SeasonLayout({ children }: { children: React.ReactNode }) {
  if (!isSupabaseConfigured()) redirect("/login?next=/season");
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) redirect("/login?next=/season");
  return <AppShell>{children}</AppShell>;
}
