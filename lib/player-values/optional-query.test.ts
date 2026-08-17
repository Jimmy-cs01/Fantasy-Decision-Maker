import { describe, expect, it, vi } from "vitest";
import { optionalQuery } from "./optional-query";

describe("optional analytics query", () => {
  it("retries one transient fetch failure and returns the typed fallback", async () => {
    const warning = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const query = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const fallback = new Map<string, number>();
    const result = await optionalQuery({
      label: "Depth chart lookup failed",
      query,
      fallback,
      retryDelayMs: 0,
    });
    expect(result).toBe(fallback);
    expect(query).toHaveBeenCalledTimes(2);
    expect(warning).toHaveBeenCalledWith(
      expect.stringMatching(
        /Depth chart lookup failed; continuing with neutral analytics context\..*"errorType":"TypeError".*"errorMessage":"fetch failed"/,
      ),
    );
    warning.mockRestore();
  });

  it("does not log a successful empty result as an error", async () => {
    const warning = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    await expect(
      optionalQuery({
        label: "Depth",
        query: async () => [],
        fallback: ["fallback"],
      }),
    ).resolves.toEqual([]);
    expect(warning).not.toHaveBeenCalled();
    warning.mockRestore();
  });
});
