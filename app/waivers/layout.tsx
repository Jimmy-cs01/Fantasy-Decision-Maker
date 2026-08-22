import { AppShell } from "@/components/dashboard/app-shell";
import { createClient } from "@/lib/supabase/server";
import { privatePageMetadata } from "@/lib/seo/metadata";

export const dynamic = "force-dynamic";
export const metadata = privatePageMetadata("Waiver Wire");
export default async function WaiversLayout({ children }: { children: React.ReactNode }) {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  return <AppShell guest={!user}>{children}</AppShell>;
}
