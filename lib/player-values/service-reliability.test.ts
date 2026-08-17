import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { getCurrentDepthRoles, getProjectionHistoryRows } from "./service";

function queryBuilder(result: {
  data: unknown;
  error: { message: string } | null;
}) {
  const chain: Record<string, unknown> = {};
  for (const method of [
    "select",
    "in",
    "eq",
    "gte",
    "lte",
    "order",
    "abortSignal",
  ]) {
    chain[method] = () => chain;
  }
  chain.then = (
    resolve: (value: typeof result) => unknown,
    reject: (reason: unknown) => unknown,
  ) => Promise.resolve(result).then(resolve, reject);
  return chain;
}

describe("optional Player Value data", () => {
  it("returns neutral depth context when Supabase returns TypeError: fetch failed", async () => {
    const warning = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const db = {
      from: vi.fn(() =>
        queryBuilder({
          data: null,
          error: { message: "TypeError: fetch failed" },
        }),
      ),
    };
    const roles = await getCurrentDepthRoles(db as never, ["player-1"], 2026, {
      leagueId: "league-1",
    });
    expect(roles).toEqual(new Map());
    expect(db.from).toHaveBeenCalledTimes(2);
    expect(warning).toHaveBeenCalledWith(
      expect.stringMatching(
        /Depth chart lookup failed.*"season":2026.*"leagueId":"league-1".*"errorMessage":"Unable to load depth chart roles: TypeError: fetch failed"/,
      ),
    );
    warning.mockRestore();
  });

  it("returns an empty prior when historical enrichment fails independently", async () => {
    const warning = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const db = {
      from: vi.fn(() =>
        queryBuilder({ data: null, error: { message: "network timeout" } }),
      ),
    };
    await expect(
      getProjectionHistoryRows(db as never, ["player-1"], 2026),
    ).resolves.toEqual([]);
    expect(warning).toHaveBeenCalledWith(
      expect.stringMatching(
        /Projection history lookup failed.*"season":2026.*"errorMessage":"Unable to load projection history: network timeout"/,
      ),
    );
    warning.mockRestore();
  });
});
