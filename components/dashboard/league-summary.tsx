import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export function LeagueSummary({ league }: { league: { id: string; name: string; season: number; total_rosters: number | null; last_synced_at: string | null } }) { return <Card><div className="flex items-start justify-between gap-4"><div><p className="text-sm font-bold tracking-widest text-cyan-300">ACTIVE LEAGUE</p><h2 className="mt-1 text-2xl font-black">{league.name}</h2><p className="mt-1 text-slate-400">{league.season} · {league.total_rosters ?? "?"} teams</p></div><Link href={`/dashboard/league/${league.id}`}><Button>View league</Button></Link></div><p className="mt-5 text-sm text-slate-400">Last synced: {league.last_synced_at ? new Date(league.last_synced_at).toLocaleString() : "Not yet synced"}</p></Card>; }
