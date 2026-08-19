import { Suspense } from "react";
import { GuestLeagueWorkspace } from "@/components/guest/guest-league-workspace";

export default async function GuestLeaguePage({ params }: { params: Promise<{ leagueId: string }> }) {
  const { leagueId } = await params;
  return <Suspense fallback={<p className="p-8 text-slate-400">Loading guest league…</p>}>
    <GuestLeagueWorkspace leagueId={leagueId} />
  </Suspense>;
}
