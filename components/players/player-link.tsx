"use client";

import Link from "next/link";
import type { MouseEvent, ReactNode } from "react";

export function PlayerLink({
  playerId,
  children,
  className = "",
  query = "",
  stopPropagation = false,
}: {
  playerId: string | null | undefined;
  children: ReactNode;
  className?: string;
  query?: string;
  stopPropagation?: boolean;
}) {
  if (!playerId) return <span className={className}>{children}</span>;
  const onClick = stopPropagation
    ? (event: MouseEvent<HTMLAnchorElement>) => event.stopPropagation()
    : undefined;
  return (
    <Link
      href={`/players/${encodeURIComponent(playerId)}${query}`}
      onClick={onClick}
      className={`rounded-sm transition hover:text-cyan-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 ${className}`}
    >
      {children}
    </Link>
  );
}
