import { describe, expect, it } from "vitest";
import { formatLocalDateTime } from "./format-local";

describe("local timestamp presentation", () => {
  it("converts UTC to America/New_York with daylight saving time", () => {
    const formatted = formatLocalDateTime("2026-08-21T22:15:00Z", "en-US", "America/New_York");
    expect(formatted).toContain("6:15 PM");
    expect(formatted).toContain("EDT");
  });

  it("keeps invalid or missing timestamp presentation safe", () => {
    expect(formatLocalDateTime("not-a-date", "en-US", "America/New_York")).toBe("—");
  });
});
