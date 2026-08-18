import Link from "next/link";
import { ArrowRightLeft, CalendarDays, ChartNoAxesCombined, LayoutDashboard, Link2, ListTree, UsersRound } from "lucide-react";
import { signOut } from "@/app/auth/actions";

export function Sidebar() {
  return <aside className="flex border-b border-slate-800 bg-slate-950/60 p-4 md:min-h-screen md:w-60 md:flex-col md:border-r md:border-b-0">
    <Link href="/dashboard" aria-label="Jimmy GM dashboard" className="flex items-center gap-2 font-black text-cyan-300"><ChartNoAxesCombined size={20} /><span className="hidden text-slate-100 md:inline">Jimmy GM</span></Link>
    <nav className="ml-auto flex gap-4 overflow-x-auto text-sm md:ml-0 md:mt-10 md:flex-col">
      <Link className="flex items-center gap-2" href="/dashboard"><LayoutDashboard size={16} /> Dashboard</Link>
      <Link className="flex items-center gap-2" href="/players"><UsersRound size={16} /> Players</Link>
      <Link className="flex items-center gap-2" href="/matchups"><CalendarDays size={16} /> Matchups</Link>
      <Link className="flex items-center gap-2" href="/depth-charts"><ListTree size={16} /> Depth Charts</Link>
      <Link className="flex items-center gap-2" href="/trades"><ArrowRightLeft size={16} /> Trade Finder</Link>
      <Link className="flex items-center gap-2" href="/dashboard/connect"><Link2 size={16} /> Connect League</Link>
    </nav>
    <form className="ml-4 md:mt-auto md:ml-0"><button formAction={signOut} className="text-sm text-slate-400 hover:text-white">Sign out</button></form>
  </aside>;
}
