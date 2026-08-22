import { notFound } from "next/navigation";
import { AnalyticsDateTime } from "@/components/analytics/analytics-date-time";
import { Card } from "@/components/ui/card";
import { getAnonymousAnalytics } from "@/lib/analytics/anonymous";
import { getRegisteredAnalytics } from "@/lib/analytics/registered";
import { isAdminIdentity } from "@/lib/auth/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AdminAnalyticsPage() {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!isAdminIdentity(user)) notFound();

  const now = new Date();
  const [analytics, anonymous] = await Promise.all([getRegisteredAnalytics(now), getAnonymousAnalytics(now)]);
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
      <h1 className="mt-1 text-3xl font-black">User analytics</h1>
      <p className="mt-2 max-w-3xl text-sm text-slate-400">Registered accounts and privacy-conscious guest/anonymous activity. All dates are shown in Eastern Time (ET).</p>
    </header>

    <section aria-label="Registered user metrics" className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {metrics.map(([label, value, detail]) => <Card key={label}>
        <p className="text-sm font-bold text-slate-300">{label}</p>
        <p className="mt-2 text-3xl font-black text-cyan-200">{value.toLocaleString()}</p>
        <p className="mt-1 text-xs text-slate-500">{detail}</p>
      </Card>)}
    </section>

    <section aria-label="Guest and anonymous metrics" className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <MetricCard label="Unregistered Visitors" value={anonymous.totalVisitors} detail="Deduplicated browser identifiers" />
      <MetricCard label="Active Unregistered · 24h" value={anonymous.active24Hours} detail={`${anonymous.active7Days.toLocaleString()} active in 7 days`} />
      <MetricCard label="Guest Mode Visitors" value={anonymous.guestVisitors} detail="Entered the ephemeral league workspace" />
      <MetricCard label="Anonymous Visitors" value={anonymous.anonymousVisitors} detail="Public browsing without Guest Mode" />
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
        <tbody className="divide-y divide-slate-800">{analytics.features.map((row) => <tr key={row.feature}><td className="px-4 py-3 font-bold text-slate-200">{row.feature}</td><td className="px-4 py-3">{row.registeredUsers}</td><td className="px-4 py-3">{row.sessions}</td><td className="px-4 py-3 text-slate-400"><AnalyticsDateTime value={row.lastUsedAt} /></td></tr>)}</tbody>
      </table></div> : <EmptyState message={analytics.activityAvailable ? "No authenticated feature activity has been recorded yet." : "Apply the authenticated analytics migration to begin recording feature activity."} />}
    </Card>

    <Card className="mt-6 overflow-hidden p-0">
      <div className="border-b border-slate-800 px-5 py-4"><h2 className="font-bold">Registered accounts</h2><p className="mt-1 text-xs text-slate-500">Sorted by latest tracked activity, league synchronization, or sign-in.</p></div>
      {analytics.users.length ? <div className="overflow-x-auto"><table className="w-full min-w-[1180px] text-sm">
        <thead className="bg-slate-950 text-left text-xs uppercase text-slate-500"><tr>{["Account", "Signed up", "Last sign-in", "Last seen", "Leagues", "Connections", "Recent league", "Recent features"].map((label) => <th key={label} className="px-4 py-3">{label}</th>)}</tr></thead>
        <tbody className="divide-y divide-slate-800">{analytics.users.map((row) => <tr key={row.id}>
          <td className="px-4 py-3"><p className="font-bold text-slate-100">{row.displayName}</p><p className="mt-0.5 text-xs text-slate-500">{row.email ?? "Email unavailable"}</p>{row.sleeperUsername ? <p className="mt-0.5 text-xs text-cyan-300">Sleeper @{row.sleeperUsername}</p> : null}</td>
          <td className="px-4 py-3 text-slate-400"><AnalyticsDateTime value={row.signedUpAt} /></td>
          <td className="px-4 py-3 text-slate-400"><AnalyticsDateTime value={row.lastSignInAt} /></td>
          <td className="px-4 py-3 text-slate-300"><AnalyticsDateTime value={row.lastActivityAt} /></td>
          <td className="px-4 py-3 font-bold">{row.leagueCount}</td>
          <td className="px-4 py-3">{row.providers.length ? row.providers.map((provider) => <span key={provider} className="mr-1 inline-flex rounded-full border border-slate-700 px-2 py-0.5 text-[10px] font-black uppercase text-slate-300">{provider}</span>) : "—"}</td>
          <td className="max-w-52 truncate px-4 py-3 text-slate-300">{row.recentLeague ?? "—"}</td>
          <td className="max-w-64 px-4 py-3 text-xs text-slate-400">{row.featureSummary.join(" · ") || "—"}</td>
        </tr>)}</tbody>
      </table></div> : <EmptyState message="No registered Jimmy GM accounts were found." />}
    </Card>

    <Card className="mt-6 overflow-hidden p-0">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-800 px-5 py-4"><div><h2 className="font-bold">Guest and anonymous visitors</h2><p className="mt-1 text-xs text-slate-500">Stable anonymous browser IDs prevent page navigation from creating new unique visitors. No Sleeper account, league data, email, or IP address is stored here.</p></div><div className="text-right text-xs text-slate-500"><p>{anonymous.totalSessions.toLocaleString()} sessions</p><p>{anonymous.totalActivities.toLocaleString()} activity events</p></div></div>
      {anonymous.visitors.length ? <div className="overflow-x-auto"><table className="w-full min-w-[860px] text-sm">
        <thead className="bg-slate-950 text-left text-xs uppercase text-slate-500"><tr>{["Visitor", "Type", "First seen", "Last seen", "Sessions", "Activity", "Last path"].map((label) => <th key={label} className="px-4 py-3">{label}</th>)}</tr></thead>
        <tbody className="divide-y divide-slate-800">{anonymous.visitors.map((row) => <tr key={row.visitorCode}>
          <td className="px-4 py-3 font-mono text-xs text-slate-400">Visitor {row.visitorCode}</td>
          <td className="px-4 py-3"><span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-black uppercase ${row.visitorType === "guest" ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-200" : "border-slate-700 text-slate-300"}`}>{row.visitorType}</span></td>
          <td className="px-4 py-3 text-slate-400"><AnalyticsDateTime value={row.firstSeen} /></td>
          <td className="px-4 py-3 text-slate-300"><AnalyticsDateTime value={row.lastSeen} /></td>
          <td className="px-4 py-3 font-bold">{row.sessionCount}</td><td className="px-4 py-3">{row.activityCount}</td><td className="max-w-64 truncate px-4 py-3 text-slate-400">{row.lastPath ?? "—"}</td>
        </tr>)}</tbody>
      </table></div> : <EmptyState message="No unregistered visitor activity has been recorded yet." />}
    </Card>

    <p className="mt-4 text-xs text-slate-600">Generated <AnalyticsDateTime value={analytics.generatedAt} /> · Eastern Time (America/New_York)</p>
  </div>;
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return <Card className="py-4"><p className="text-xs font-black uppercase tracking-wider text-slate-500">{label}</p><p className="mt-1 text-2xl font-black text-slate-100">{value.toLocaleString()}</p></Card>;
}

function MetricCard({ label, value, detail }: { label: string; value: number; detail: string }) {
  return <Card><p className="text-sm font-bold text-slate-300">{label}</p><p className="mt-2 text-3xl font-black text-cyan-200">{value.toLocaleString()}</p><p className="mt-1 text-xs text-slate-500">{detail}</p></Card>;
}

function EmptyState({ message }: { message: string }) {
  return <div className="px-5 py-10 text-center text-sm text-slate-400">{message}</div>;
}
