"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import type { PositionFilter } from "@/lib/players/types";

export function PositionFilterNav({ selected, items }: { selected: PositionFilter; items: Array<{ position: PositionFilter; href: string }> }) {
  const selectedRef = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [selected]);
  return <nav aria-label="Position filter" className="flex snap-x touch-pan-x gap-2 overflow-x-auto overscroll-x-contain px-0.5 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
    {items.map(({ position, href }) => <Link
      key={position}
      ref={selected === position ? selectedRef : undefined}
      href={href}
      aria-current={selected === position ? "page" : undefined}
      className={`min-w-16 snap-center rounded-full border px-4 py-2 text-center text-sm font-black transition sm:min-w-20 ${selected === position ? "border-cyan-300 bg-cyan-400/15 text-cyan-200 shadow-[0_0_20px_rgba(34,211,238,0.12)]" : "border-slate-800 bg-slate-900/80 text-slate-400 hover:border-slate-600 hover:text-white"}`}
    >{position}</Link>)}
  </nav>;
}
