import { formatAnalyticsDateTime } from "@/lib/dates/format-analytics";

export function AnalyticsDateTime({ value }: { value: string | null }) {
  if (!value) return <>—</>;
  return <time dateTime={value} title="Stored in UTC; displayed in America/New_York">{formatAnalyticsDateTime(value)}</time>;
}
