import { Sidebar } from "@/components/dashboard/sidebar";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
export const dynamic = "force-dynamic";
export default async function DepthChartsLayout({ children }: { children: React.ReactNode }) {
  if (!isSupabaseConfigured()) return children;
  const db = await createClient(); const { data: { user } } = await db.auth.getUser();
  return <div className="min-h-screen md:flex"><Sidebar guest={!user} /><main className="min-w-0 flex-1 p-4 sm:p-5 md:p-8">{children}</main></div>;
}
