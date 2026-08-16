"use client";

import Image from "next/image";
import { useState } from "react";

export function playerInitials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

export function isTrustedHeadshotUrl(url: string | null | undefined) {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === "static.www.nfl.com" && parsed.pathname.startsWith("/image/upload/");
  } catch {
    return false;
  }
}

export function PlayerAvatar({ name, headshotUrl }: { name: string; headshotUrl: string | null }) {
  const [failed, setFailed] = useState(false);
  const showImage = !failed && isTrustedHeadshotUrl(headshotUrl);
  return <span className="relative flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-cyan-400/20 bg-gradient-to-br from-cyan-400/20 to-blue-500/10 text-[10px] font-black text-cyan-100 sm:size-9">
    {showImage ? <Image src={headshotUrl!} alt={`${name} headshot`} fill sizes="(max-width: 639px) 32px, 36px" className="object-cover object-top" onError={() => setFailed(true)} /> : <span aria-label={`${name} initials`}>{playerInitials(name)}</span>}
  </span>;
}

