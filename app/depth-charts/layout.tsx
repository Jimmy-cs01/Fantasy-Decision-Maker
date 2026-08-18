import { redirect } from "next/navigation";
import { Sidebar } from "@/components/dashboard/sidebar";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
export const dynamic = "force-dynamic";
export default async function DepthChartsLayout({ children }: { children: React.ReactNode }) {
  if (!isSupabaseConfigured()) redirect("/login?next=/depth-charts");
  const db = await createClient(); const { data: { user } } = await db.auth.getUser();
  if (!user) redirect("/login?next=/depth-charts");
  return <div className="min-h-screen md:flex"><Sidebar /><main className="min-w-0 flex-1 p-4 sm:p-5 md:p-8">{children}</main></div>;
}
