import { cn } from "@/lib/utils";
import type { HTMLAttributes } from "react";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-xl border border-slate-700/80 bg-slate-900/70 p-5 shadow-2xl shadow-slate-950/20 backdrop-blur", className)} {...props} />;
}
