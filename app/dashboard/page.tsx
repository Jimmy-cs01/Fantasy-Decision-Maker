import Link from "next/link";
import { Plus } from "lucide-react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LeagueSummary } from "@/components/dashboard/league-summary";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default async function DashboardPage() { const db = await createClient(); const { data: { user } } = await db.auth.getUser(); if (!user) redirect("/login?next=%2Fdashboard"); const { data: leagues, error } = await db.from("leagues").select("id,name,season,total_rosters,last_synced_at,provider").eq("owner_id", user.id).order("last_synced_at", { ascending: false }); if (error) console.error("Unable to load leagues", error); return <div className="mx-auto max-w-5xl"><div className="flex items-center justify-between"><div><p className="text-sm font-bold tracking-widest text-cyan-300">DASHBOARD</p><h1 className="mt-1 text-3xl font-black">Your leagues</h1></div><Link href="/dashboard/connect"><Button className="flex items-center gap-2"><Plus size={17} /> Connect league</Button></Link></div>{leagues?.length ? <div className="mt-7 grid gap-4">{leagues.map((league) => <LeagueSummary key={league.id} league={league} />)}</div> : <Card className="mt-8 text-center"><h2 className="text-xl font-bold">No leagues connected yet</h2><p className="mt-2 text-slate-400">Connect Sleeper or Yahoo to import your roster and league settings.</p><Link className="mt-5 inline-block" href="/dashboard/connect"><Button>Connect a league</Button></Link></Card>}</div>; }
