"use client";

import { Eye, EyeOff } from "lucide-react";
import { forwardRef, useState, type InputHTMLAttributes } from "react";

export const PasswordInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function PasswordInput(
  { className = "", ...props },
  ref,
) {
  const [visible, setVisible] = useState(false);
  return <span className="relative mt-1.5 block">
    <input
      {...props}
      ref={ref}
      type={visible ? "text" : "password"}
      className={`min-h-12 w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 pr-12 text-white transition outline-none placeholder:text-slate-600 focus:border-cyan-400 ${className}`}
    />
    <button
      type="button"
      aria-label={visible ? "Hide password" : "Show password"}
      aria-pressed={visible}
      onClick={() => setVisible((value) => !value)}
      className="absolute inset-y-1 right-1 flex min-w-10 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-cyan-300"
    >{visible ? <EyeOff aria-hidden="true" size={19} /> : <Eye aria-hidden="true" size={19} />}</button>
  </span>;
});
