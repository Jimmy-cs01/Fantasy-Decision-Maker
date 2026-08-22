import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./record-anonymous.ts", import.meta.url), "utf8");

describe("anonymous analytics rolling deployment compatibility", () => {
  it("falls back to the existing three-argument RPC only when the new overload is missing", () => {
    expect(source).toContain('current.error.code !== "PGRST202"');
    expect(source.match(/record_guest_activity/g)).toHaveLength(2);
    expect(source).toContain("visitor_kind: input.visitorType");
  });
});
