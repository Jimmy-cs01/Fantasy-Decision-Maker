"use client";

import { useSyncExternalStore } from "react";
import { formatLocalDateTime } from "@/lib/dates/format-local";

const subscribe = () => () => undefined;

export function LocalDateTime({ value }: { value: string | null }) {
  const localValue = useSyncExternalStore(
    subscribe,
    () => value ? formatLocalDateTime(value) : "—",
    () => null,
  );

  if (!value) return <>—</>;
  const utcFallback = formatLocalDateTime(value, "en-US", "UTC");
  return <time dateTime={value} title={`${utcFallback} (stored UTC)`}>{localValue ?? utcFallback}</time>;
}
