import { redirect } from "next/navigation";
import { Sidebar } from "@/components/dashboard/sidebar";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function PlayersLayout({ children }: { children: React.ReactNode }) {
  if (!isSupabaseConfigured()) redirect("/auth");
  const db = await createClient(); const { data: { user } } = await db.auth.getUser();
  if (!user) redirect("/auth");
  return <div className="min-h-screen md:flex"><Sidebar /><main className="min-w-0 flex-1 p-5 md:p-8">{children}</main></div>;
}
