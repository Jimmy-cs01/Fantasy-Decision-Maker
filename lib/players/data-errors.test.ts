import { describe, expect, it } from "vitest";
import { classifyPublicDataError, publicPlayerDataMessage } from "./data-errors";

describe("public player data errors", () => {
  it("distinguishes missing schema from anonymous permission denial", () => {
    expect(classifyPublicDataError({ code: "42P01", message: "relation does not exist" })).toBe("missing_schema");
    expect(classifyPublicDataError({ code: "42501", message: "permission denied" })).toBe("permission_denied");
    expect(publicPlayerDataMessage({ code: "42501", message: "permission denied" })).not.toContain("migration");
  });

  it("distinguishes backend failures", () => {
    expect(classifyPublicDataError(new TypeError("fetch failed"))).toBe("backend_unavailable");
  });
});
