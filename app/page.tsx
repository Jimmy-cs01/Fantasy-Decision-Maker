import Link from "next/link";
import { ArrowRight, ChartNoAxesCombined } from "lucide-react";
import { Card } from "@/components/ui/card";

export default function Home() {
  return <main className="mx-auto flex min-h-screen max-w-6xl items-center p-6"><section className="max-w-2xl"><div className="mb-6 flex items-center gap-2 text-cyan-300"><ChartNoAxesCombined /> FANTASY DECISION MAKER</div><h1 className="text-5xl font-black tracking-tight sm:text-6xl">Your league data.<br /><span className="text-cyan-300">Clearer decisions.</span></h1><p className="mt-6 text-lg leading-8 text-slate-300">Connect Sleeper, bring your league into one private workspace, and build toward smarter roster decisions.</p><Link className="mt-8 inline-flex items-center gap-2 rounded-lg bg-cyan-400 px-5 py-3 font-bold text-slate-950" href="/dashboard">Open dashboard <ArrowRight size={18} /></Link></section><Card className="ml-auto hidden w-72 sm:block"><p className="text-sm text-slate-400">Built for</p><p className="mt-2 text-2xl font-bold">Your league</p><div className="mt-6 space-y-3"><div className="h-3 w-4/5 rounded bg-cyan-400/80" /><div className="h-3 w-full rounded bg-slate-700" /><div className="h-3 w-3/5 rounded bg-slate-700" /></div></Card></main>;
}
