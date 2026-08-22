import { describe, expect, it } from "vitest";
import { formatAnalyticsDateTime } from "./format-analytics";

describe("Analytics Eastern Time formatting", () => {
  it("uses EDT automatically during August and labels the display ET", () => {
    expect(formatAnalyticsDateTime("2026-08-21T22:15:00Z")).toBe("Aug 21, 2026, 6:15 PM ET");
  });

  it("uses the same IANA zone across the winter DST boundary", () => {
    expect(formatAnalyticsDateTime("2026-12-21T22:15:00Z")).toBe("Dec 21, 2026, 5:15 PM ET");
  });
});
