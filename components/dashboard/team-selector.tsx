"use client";

import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  adjacentNavigationIndex,
  horizontalScrollState,
  horizontalWheelDelta,
} from "@/lib/ui/horizontal-navigation";

export interface TeamSelectorItem {
  id: string;
  href: string;
  label: string;
  detail?: string | null;
  projectedPpg?: number | null;
  selected: boolean;
}

const INITIAL_SCROLL_STATE = {
  canScrollLeft: false,
  canScrollRight: false,
};

export function TeamSelector({ items }: { items: TeamSelectorItem[] }) {
  const stripRef = useRef<HTMLDivElement>(null);
  const [scrollState, setScrollState] = useState(INITIAL_SCROLL_STATE);

  const updateScrollState = useCallback(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const next = horizontalScrollState(
      strip.scrollLeft,
      strip.clientWidth,
      strip.scrollWidth,
    );
    setScrollState((current) =>
      current.canScrollLeft === next.canScrollLeft &&
      current.canScrollRight === next.canScrollRight
        ? current
        : next,
    );
  }, []);

  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const handleWheel = (event: WheelEvent) => {
      if (strip.scrollWidth <= strip.clientWidth) return;
      const delta = horizontalWheelDelta(
        event.deltaX,
        event.deltaY,
        event.deltaMode,
        strip.clientWidth,
      );
      const current = horizontalScrollState(
        strip.scrollLeft,
        strip.clientWidth,
        strip.scrollWidth,
      );
      const canMove =
        delta < 0 ? current.canScrollLeft : current.canScrollRight;
      if (!canMove) return;
      event.preventDefault();
      strip.scrollBy({ left: delta, behavior: "auto" });
    };
    const selected = strip.querySelector<HTMLElement>("[aria-current='page']");
    selected?.scrollIntoView({ block: "nearest", inline: "nearest" });
    const animationFrame = requestAnimationFrame(updateScrollState);
    const resizeObserver = new ResizeObserver(updateScrollState);
    resizeObserver.observe(strip);
    strip.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      resizeObserver.disconnect();
      strip.removeEventListener("wheel", handleWheel);
      cancelAnimationFrame(animationFrame);
    };
  }, [items, updateScrollState]);

  const scroll = (direction: "left" | "right") => {
    const strip = stripRef.current;
    if (!strip) return;
    strip.scrollBy({
      left:
        (direction === "right" ? 1 : -1) *
        Math.max(180, strip.clientWidth * 0.7),
      behavior: "smooth",
    });
  };

  const handleItemKeyDown = (
    event: React.KeyboardEvent<HTMLAnchorElement>,
    index: number,
  ) => {
    if (event.key === " ") {
      event.preventDefault();
      event.currentTarget.click();
      return;
    }
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const nextIndex = adjacentNavigationIndex(
      index,
      event.key === "ArrowRight" ? "right" : "left",
      items.length,
    );
    const target =
      stripRef.current?.querySelectorAll<HTMLAnchorElement>("a[data-team]")[
        nextIndex
      ];
    target?.focus();
    target?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
      behavior: "smooth",
    });
  };

  return (
    <nav
      aria-label="League teams"
      className="relative mt-5 grid grid-cols-[2.25rem_minmax(0,1fr)_2.25rem] items-center gap-1"
    >
      <button
        type="button"
        onClick={() => scroll("left")}
        disabled={!scrollState.canScrollLeft}
        aria-label="Scroll to previous teams"
        className="grid size-9 place-items-center rounded-full border border-slate-600 bg-slate-950 text-cyan-100 shadow-lg transition hover:border-cyan-300 hover:bg-cyan-400/10 disabled:cursor-default disabled:opacity-25"
      >
        <ChevronLeft aria-hidden="true" size={18} />
      </button>
      <div
        ref={stripRef}
        onScroll={updateScrollState}
        className="flex touch-pan-x snap-x [scrollbar-width:thin] [scrollbar-color:#334155_transparent] gap-2 overflow-x-auto overscroll-x-contain py-1"
      >
        {items.map((item, index) => (
          <Link
            key={item.id}
            data-team
            href={item.href}
            aria-current={item.selected ? "page" : undefined}
            onKeyDown={(event) => handleItemKeyDown(event, index)}
            className={`min-w-max snap-start rounded-full border px-3.5 py-2 text-sm font-bold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 ${item.selected ? "border-cyan-300 bg-cyan-400/15 text-cyan-100" : "border-slate-800 bg-slate-900 text-slate-400 hover:text-white"}`}
          >
            <span>
              {item.label}
              {item.detail ? (
                <span className="ml-1 text-xs opacity-70">· {item.detail}</span>
              ) : null}
            </span>
            {item.projectedPpg != null ? (
              <span className="ml-2 text-xs text-cyan-300 tabular-nums">
                {item.projectedPpg.toFixed(1)}
              </span>
            ) : null}
          </Link>
        ))}
      </div>
      <button
        type="button"
        onClick={() => scroll("right")}
        disabled={!scrollState.canScrollRight}
        aria-label="Scroll to more teams"
        className="grid size-9 place-items-center rounded-full border border-slate-600 bg-slate-950 text-cyan-100 shadow-lg transition hover:border-cyan-300 hover:bg-cyan-400/10 disabled:cursor-default disabled:opacity-25"
      >
        <ChevronRight aria-hidden="true" size={18} />
      </button>
    </nav>
  );
}
