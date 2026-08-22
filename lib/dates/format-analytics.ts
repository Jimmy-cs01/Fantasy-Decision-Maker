export const ANALYTICS_TIME_ZONE = "America/New_York";

export function formatAnalyticsDateTime(value: string, locale = "en-US") {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const formatted = new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: ANALYTICS_TIME_ZONE,
  }).format(date);
  return `${formatted} ET`;
}
