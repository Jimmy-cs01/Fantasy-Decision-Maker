"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  adjacentNavigationIndex,
  horizontalScrollState,
  horizontalWheelDelta,
} from "@/lib/ui/horizontal-navigation";

export function TeamChoiceStrip({
  items,
  selectedId,
  onSelect,
  label,
}: {
  items: Array<{ id: string; name: string }>;
  selectedId: string;
  onSelect: (id: string) => void;
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState({
    canScrollLeft: false,
    canScrollRight: false,
  });
  const update = useCallback(() => {
    const element = ref.current;
    if (element)
      setState(
        horizontalScrollState(
          element.scrollLeft,
          element.clientWidth,
          element.scrollWidth,
        ),
      );
  }, []);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      if (element.scrollWidth <= element.clientWidth) return;
      const delta = horizontalWheelDelta(
        event.deltaX,
        event.deltaY,
        event.deltaMode,
        element.clientWidth,
      );
      const current = horizontalScrollState(
        element.scrollLeft,
        element.clientWidth,
        element.scrollWidth,
      );
      if (!(delta < 0 ? current.canScrollLeft : current.canScrollRight)) return;
      event.preventDefault();
      element.scrollBy({ left: delta, behavior: "auto" });
    };
    ref.current
      ?.querySelector<HTMLElement>("[aria-selected='true']")
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
    const frame = requestAnimationFrame(update);
    const resize = new ResizeObserver(update);
    resize.observe(element);
    element.addEventListener("wheel", wheel, { passive: false });
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      element.removeEventListener("wheel", wheel);
    };
  }, [items, selectedId, update]);
  const scroll = (direction: -1 | 1) =>
    ref.current?.scrollBy({
      left: direction * Math.max(180, ref.current.clientWidth * 0.7),
      behavior: "smooth",
    });
  return (
    <div className="mt-2 grid grid-cols-[2rem_minmax(0,1fr)_2rem] items-center gap-1">
      <button
        type="button"
        aria-label={`Previous ${label}`}
        disabled={!state.canScrollLeft}
        onClick={() => scroll(-1)}
        className="grid size-8 place-items-center rounded-full border border-slate-700 bg-slate-950 text-cyan-200 disabled:opacity-20"
      >
        <ChevronLeft size={16} />
      </button>
      <div
        ref={ref}
        onScroll={update}
        role="listbox"
        aria-label={label}
        className="flex touch-pan-x [scrollbar-width:thin] gap-2 overflow-x-auto pb-1"
      >
        {items.map((item, index) => (
          <button
            key={item.id}
            data-choice
            type="button"
            role="option"
            aria-selected={item.id === selectedId}
            onClick={() => onSelect(item.id)}
            onKeyDown={(event) => {
              if (event.key !== "ArrowLeft" && event.key !== "ArrowRight")
                return;
              event.preventDefault();
              const next = adjacentNavigationIndex(
                index,
                event.key === "ArrowRight" ? "right" : "left",
                items.length,
              );
              ref.current
                ?.querySelectorAll<HTMLButtonElement>("button[data-choice]")
                [next]?.focus();
            }}
            className={`min-h-10 min-w-max rounded-full border px-3 py-2 text-sm font-bold ${item.id === selectedId ? "border-cyan-300 bg-cyan-400/15 text-cyan-100" : "border-slate-700 bg-slate-950 text-slate-400"}`}
          >
            {item.name}
          </button>
        ))}
      </div>
      <button
        type="button"
        aria-label={`More ${label}`}
        disabled={!state.canScrollRight}
        onClick={() => scroll(1)}
        className="grid size-8 place-items-center rounded-full border border-slate-700 bg-slate-950 text-cyan-200 disabled:opacity-20"
      >
        <ChevronRight size={16} />
      </button>
    </div>
  );
}
