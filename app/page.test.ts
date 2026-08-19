import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

describe("landing page guest entry", () => {
  it("links directly to guest mode from the header and primary actions", () => {
    expect(source.match(/href="\/guest"/g)).toHaveLength(2);
    expect(source).toContain("Continue as Guest");
    expect(source).toContain("without creating an account");
  });
});
