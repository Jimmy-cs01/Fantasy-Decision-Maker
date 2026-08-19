import Link from "next/link";
import {
  ArrowRight,
  ChartNoAxesCombined,
  History,
  Scale,
  ShieldCheck,
  UsersRound,
} from "lucide-react";

const features = [
  { icon: UsersRound, text: "Sync Sleeper leagues and compare every roster" },
  { icon: History, text: "Explore player stats and historical performance" },
  { icon: Scale, text: "See results through your league’s scoring settings" },
  { icon: ShieldCheck, text: "Build toward trade and lineup decision tools" },
];

export default function Home() {
  return (
    <main className="relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_75%_15%,rgba(34,211,238,0.16),transparent_30%)]" />
      <div className="relative mx-auto flex min-h-screen max-w-6xl flex-col px-5 py-6 sm:px-8 lg:px-10">
        <header className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-xs font-black tracking-[0.18em] text-cyan-300 sm:text-sm">
            <ChartNoAxesCombined aria-hidden="true" size={20} /> JIMMY GM
          </div>
          <nav aria-label="Account options" className="flex items-center gap-3 text-sm font-bold">
            <Link href="/guest" className="text-cyan-300 transition hover:text-cyan-200">
              Continue as Guest
            </Link>
            <Link href="/login" className="hidden text-slate-300 transition hover:text-white sm:block">
              Log In
            </Link>
          </nav>
        </header>

        <div className="grid flex-1 items-center gap-10 py-12 lg:grid-cols-[1.08fr_0.92fr] lg:py-16">
          <section>
            <p className="text-xs font-black tracking-[0.22em] text-cyan-300 uppercase">
              Fantasy football, with context
            </p>
            <h1 className="mt-4 max-w-3xl text-4xl font-black tracking-[-0.04em] sm:text-6xl lg:text-7xl">
              Your league data.
              <br />
              <span className="text-cyan-300">Clearer decisions.</span>
            </h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-slate-300 sm:text-lg">
              Bring your Sleeper or Yahoo league, historical NFL performance, and custom
              scoring into one focused workspace.
            </p>
            <div className="mt-7 grid gap-3 sm:flex">
              <Link
                href="/login"
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-cyan-400 px-6 py-3 font-black text-slate-950 transition hover:bg-cyan-300"
              >
                Log In <ArrowRight aria-hidden="true" size={18} />
              </Link>
              <Link
                href="/signup"
                className="inline-flex min-h-12 items-center justify-center rounded-xl border border-slate-600 bg-slate-900/70 px-6 py-3 font-black text-white transition hover:border-cyan-400/60 hover:bg-slate-800"
              >
                Create Account
              </Link>
              <Link
                href="/guest"
                className="inline-flex min-h-12 items-center justify-center rounded-xl border border-cyan-400/50 bg-cyan-400/5 px-6 py-3 font-black text-cyan-200 transition hover:border-cyan-300 hover:bg-cyan-400/10"
              >
                Continue as Guest
              </Link>
            </div>
            <p className="mt-3 text-xs text-slate-500">
              Guest mode lets you try public Sleeper league tools without creating an account.
            </p>
          </section>

          <section
            aria-label="Product capabilities"
            className="rounded-2xl border border-slate-700/80 bg-slate-900/70 p-4 shadow-2xl shadow-slate-950/30 backdrop-blur sm:p-6"
          >
            <p className="px-1 text-xs font-black tracking-[0.2em] text-slate-500 uppercase">
              Built for your league
            </p>
            <div className="mt-3 grid gap-2.5">
              {features.map(({ icon: Icon, text }) => (
                <div
                  key={text}
                  className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-950/55 p-3.5"
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-cyan-400/10 text-cyan-300">
                    <Icon aria-hidden="true" size={18} />
                  </span>
                  <p className="text-sm leading-5 font-semibold text-slate-200">
                    {text}
                  </p>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
