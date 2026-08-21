import Link from "next/link";
import type { ReactNode } from "react";
import { BrandLogo } from "@/components/brand/brand-logo";

export function AuthFrame({ eyebrow, title, description, children, footer }: {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return <main className="relative grid min-h-screen place-items-center overflow-hidden px-4 py-8 sm:px-6">
    <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(34,211,238,0.14),transparent_35%)]" />
    <div className="relative w-full max-w-md">
      <Link href="/" className="mb-5 inline-flex items-center gap-2 text-xs font-black tracking-[0.18em] text-cyan-300 transition hover:text-cyan-200">
        <BrandLogo size={22} label="JIMMY GM" />
      </Link>
      <section className="rounded-2xl border border-slate-700/80 bg-slate-900/85 p-5 shadow-2xl shadow-slate-950/40 backdrop-blur sm:p-7">
        <p className="text-xs font-black uppercase tracking-[0.2em] text-cyan-300">{eyebrow}</p>
        <h1 className="mt-2 text-3xl font-black tracking-tight">{title}</h1>
        <p className="mt-2 text-sm leading-6 text-slate-400">{description}</p>
        {children}
        <div className="mt-6 border-t border-slate-800 pt-5 text-center text-sm text-slate-400">{footer}</div>
      </section>
    </div>
  </main>;
}
