import { notFound } from "next/navigation";
import { Card } from "@/components/ui/card";
import { isAdminIdentity } from "@/lib/auth/admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

async function countRegisteredUsers() {
  const admin = createAdminClient();
  let page = 1; let total = 0;
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`Unable to count registered users: ${error.message}`);
    total += data.users.length;
    if (data.users.length < 1000) return total;
    page += 1;
  }
}

export default async function AdminAnalyticsPage() {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!isAdminIdentity(user)) notFound();
  const admin = createAdminClient();
  const [registeredUsers, guests, sessions, leagues, recent] = await Promise.all([
    countRegisteredUsers(),
    admin.from("guest_visitors").select("anonymous_id", { count: "exact", head: true }),
    admin.from("guest_sessions").select("id", { count: "exact", head: true }),
    admin.from("leagues").select("id", { count: "exact", head: true }).not("last_synced_at", "is", null),
    admin.from("guest_visitors").select("anonymous_id,first_seen,last_seen,session_count,visit_count,last_path").order("last_seen", { ascending: false }).limit(25),
  ]);
  const queryError = guests.error ?? sessions.error ?? leagues.error ?? recent.error;
  if (queryError) throw new Error(`Unable to load admin analytics: ${queryError.message}`);
  const metrics = [["Registered users", registeredUsers], ["Unique guests", guests.count ?? 0], ["Guest sessions", sessions.count ?? 0], ["Leagues synced", leagues.count ?? 0]] as const;
  return <div className="mx-auto max-w-6xl"><p className="text-xs font-black tracking-[.2em] text-cyan-300">ADMIN</p><h1 className="mt-1 text-3xl font-black">Usage analytics</h1><p className="mt-2 text-sm text-slate-400">Anonymous guest UUIDs only. No IP address, email, or cross-device identity is collected.</p><section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{metrics.map(([label, value]) => <Card key={label}><p className="text-sm text-slate-400">{label}</p><p className="mt-2 text-3xl font-black text-cyan-200">{value.toLocaleString()}</p></Card>)}</section><Card className="mt-6 overflow-hidden p-0"><div className="border-b border-slate-800 px-5 py-4"><h2 className="font-bold">Recent guest activity</h2></div><div className="overflow-x-auto"><table className="w-full min-w-[720px] text-sm"><thead className="bg-slate-950 text-left text-xs uppercase text-slate-500"><tr>{["Anonymous guest", "First seen", "Last seen", "Sessions", "Visits", "Last page"].map((label) => <th key={label} className="px-4 py-3">{label}</th>)}</tr></thead><tbody className="divide-y divide-slate-800">{recent.data?.map((row) => <tr key={row.anonymous_id}><td className="px-4 py-3 font-mono text-xs">{row.anonymous_id.slice(0, 8)}…</td><td className="px-4 py-3">{new Date(row.first_seen).toLocaleString()}</td><td className="px-4 py-3">{new Date(row.last_seen).toLocaleString()}</td><td className="px-4 py-3">{row.session_count}</td><td className="px-4 py-3">{row.visit_count}</td><td className="px-4 py-3">{row.last_path ?? "—"}</td></tr>)}</tbody></table></div></Card></div>;
}
