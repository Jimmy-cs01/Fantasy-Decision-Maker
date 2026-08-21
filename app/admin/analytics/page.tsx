import { notFound } from "next/navigation";
import { Card } from "@/components/ui/card";
import { LocalDateTime } from "@/components/ui/local-date-time";
import { getRegisteredAnalytics } from "@/lib/analytics/registered";
import { isAdminIdentity } from "@/lib/auth/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AdminAnalyticsPage() {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!isAdminIdentity(user)) notFound();

  const analytics = await getRegisteredAnalytics();
  const metrics = [
    ["Registered Users", analytics.totalRegisteredUsers, "Verified non-anonymous Auth accounts"],
    ["Active · 24h", analytics.activeUsers24Hours, "Tracked activity, sync, or sign-in"],
    ["Active · 7d", analytics.activeUsers7Days, "Distinct registered accounts"],
    ["Active · 30d", analytics.activeUsers30Days, "Distinct registered accounts"],
    ["Connected Users", analytics.usersWithLeagues, "At least one saved league"],
    ["Without Leagues", analytics.usersWithoutLeagues, "Registered, no saved league"],
    ["Sleeper Connected", analytics.sleeperConnectedUsers, "Distinct registered accounts"],
    ["Yahoo Connected", analytics.yahooConnectedUsers, "Distinct registered accounts"],
  ] as const;

  return <div className="mx-auto max-w-7xl">
    <header>
      <p className="text-xs font-black tracking-[.2em] text-cyan-300">ADMIN</p>
      <h1 className="mt-1 text-3xl font-black">Registered user analytics</h1>
      <p className="mt-2 max-w-3xl text-sm text-slate-400">Authenticated Jimmy GM accounts only. Guest browsers, guest sessions, Sleeper league members, and Yahoo league members are excluded.</p>
    </header>

    <section aria-label="Registered user metrics" className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {metrics.map(([label, value, detail]) => <Card key={label}>
        <p className="text-sm font-bold text-slate-300">{label}</p>
        <p className="mt-2 text-3xl font-black text-cyan-200">{value.toLocaleString()}</p>
        <p className="mt-1 text-xs text-slate-500">{detail}</p>
      </Card>)}
    </section>

    <section aria-label="Registration and league connection summary" className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <SummaryCard label="New · 24h" value={analytics.newUsers24Hours} />
      <SummaryCard label="New · 7d" value={analytics.newUsers7Days} />
      <SummaryCard label="New · 30d" value={analytics.newUsers30Days} />
      <SummaryCard label="League Connections" value={analytics.totalLeagueConnections} />
    </section>

    <Card className="mt-6 overflow-hidden p-0">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-800 px-5 py-4">
        <div><h2 className="font-bold">Authenticated feature usage</h2><p className="mt-1 text-xs text-slate-500">Distinct registered accounts and browser sessions. Repeated page events never duplicate active-user totals.</p></div>
        {!analytics.activityAvailable ? <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-xs font-bold text-amber-200">Activity migration pending</span> : null}
      </div>
      {analytics.features.length ? <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm">
        <thead className="bg-slate-950 text-left text-xs uppercase text-slate-500"><tr>{["Feature", "Registered users", "Sessions", "Last used"].map((label) => <th key={label} className="px-4 py-3">{label}</th>)}</tr></thead>
        <tbody className="divide-y divide-slate-800">{analytics.features.map((row) => <tr key={row.feature}><td className="px-4 py-3 font-bold text-slate-200">{row.feature}</td><td className="px-4 py-3">{row.registeredUsers}</td><td className="px-4 py-3">{row.sessions}</td><td className="px-4 py-3 text-slate-400"><LocalDateTime value={row.lastUsedAt} /></td></tr>)}</tbody>
      </table></div> : <EmptyState message={analytics.activityAvailable ? "No authenticated feature activity has been recorded yet." : "Apply the authenticated analytics migration to begin recording feature activity."} />}
    </Card>

    <Card className="mt-6 overflow-hidden p-0">
      <div className="border-b border-slate-800 px-5 py-4"><h2 className="font-bold">Registered accounts</h2><p className="mt-1 text-xs text-slate-500">Sorted by latest tracked activity, league synchronization, or sign-in.</p></div>
      {analytics.users.length ? <div className="overflow-x-auto"><table className="w-full min-w-[1180px] text-sm">
        <thead className="bg-slate-950 text-left text-xs uppercase text-slate-500"><tr>{["Account", "Signed up", "Last sign-in", "Last seen", "Leagues", "Connections", "Recent league", "Recent features"].map((label) => <th key={label} className="px-4 py-3">{label}</th>)}</tr></thead>
        <tbody className="divide-y divide-slate-800">{analytics.users.map((row) => <tr key={row.id}>
          <td className="px-4 py-3"><p className="font-bold text-slate-100">{row.displayName}</p><p className="mt-0.5 text-xs text-slate-500">{row.email ?? "Email unavailable"}</p>{row.sleeperUsername ? <p className="mt-0.5 text-xs text-cyan-300">Sleeper @{row.sleeperUsername}</p> : null}</td>
          <td className="px-4 py-3 text-slate-400"><LocalDateTime value={row.signedUpAt} /></td>
          <td className="px-4 py-3 text-slate-400"><LocalDateTime value={row.lastSignInAt} /></td>
          <td className="px-4 py-3 text-slate-300"><LocalDateTime value={row.lastActivityAt} /></td>
          <td className="px-4 py-3 font-bold">{row.leagueCount}</td>
          <td className="px-4 py-3">{row.providers.length ? row.providers.map((provider) => <span key={provider} className="mr-1 inline-flex rounded-full border border-slate-700 px-2 py-0.5 text-[10px] font-black uppercase text-slate-300">{provider}</span>) : "—"}</td>
          <td className="max-w-52 truncate px-4 py-3 text-slate-300">{row.recentLeague ?? "—"}</td>
          <td className="max-w-64 px-4 py-3 text-xs text-slate-400">{row.featureSummary.join(" · ") || "—"}</td>
        </tr>)}</tbody>
      </table></div> : <EmptyState message="No registered Jimmy GM accounts were found." />}
    </Card>

    <p className="mt-4 text-xs text-slate-600">Generated <LocalDateTime value={analytics.generatedAt} /> · Guest analytics remain stored separately and are not shown on this page.</p>
  </div>;
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return <Card className="py-4"><p className="text-xs font-black uppercase tracking-wider text-slate-500">{label}</p><p className="mt-1 text-2xl font-black text-slate-100">{value.toLocaleString()}</p></Card>;
}

function EmptyState({ message }: { message: string }) {
  return <div className="px-5 py-10 text-center text-sm text-slate-400">{message}</div>;
}
