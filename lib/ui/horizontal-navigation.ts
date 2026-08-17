export function horizontalScrollState(
  scrollLeft: number,
  clientWidth: number,
  scrollWidth: number,
) {
  const tolerance = 2;
  return {
    canScrollLeft: scrollLeft > tolerance,
    canScrollRight: scrollLeft + clientWidth < scrollWidth - tolerance,
  };
}

export function horizontalWheelDelta(
  deltaX: number,
  deltaY: number,
  deltaMode = 0,
  pageWidth = 0,
) {
  const raw = Math.abs(deltaX) > Math.abs(deltaY) ? deltaX : deltaY;
  if (deltaMode === 1) return raw * 40;
  if (deltaMode === 2) return raw * Math.max(1, pageWidth);
  return raw;
}

export function adjacentNavigationIndex(
  currentIndex: number,
  direction: "left" | "right",
  itemCount: number,
) {
  if (!itemCount) return -1;
  const offset = direction === "right" ? 1 : -1;
  return Math.min(itemCount - 1, Math.max(0, currentIndex + offset));
}
