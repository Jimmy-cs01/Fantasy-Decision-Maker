import { AppShell } from "@/components/dashboard/app-shell";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

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
