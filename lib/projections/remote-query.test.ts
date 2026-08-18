import { describe, expect, it, vi } from "vitest";
import {
  countRequiredInputFailures,
  describeRemoteError,
  isTransientRemoteError,
  runBatchedRemoteQuery,
  runRemoteQuery,
} from "./remote-query";

describe("projection reconciliation remote queries", () => {
  it("splits identifiers into conservative batches", async () => {
    const batches: string[][] = [];
    const result = await runBatchedRemoteQuery({
      label: "roles",
      values: Array.from({ length: 161 }, (_, index) => `player-${index}`),
      batchSize: 75,
      query: async (batch) => {
        batches.push(batch);
        return { data: batch, error: null };
      },
    });

    expect(batches.map((batch) => batch.length)).toEqual([75, 75, 11]);
    expect(result.data).toHaveLength(161);
    expect(result.queryFailures).toBe(0);
  });

  it("retries transient network failures with bounded backoff", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ data: null, error: { message: "TypeError: fetch failed", details: "ECONNRESET" } })
      .mockResolvedValueOnce({ data: [{ id: "ok" }], error: null });
    const wait = vi.fn().mockResolvedValue(undefined);

    const result = await runRemoteQuery({ label: "history", query, wait });

    expect(result.error).toBeNull();
    expect(result.attempts).toBe(2);
    expect(wait).toHaveBeenCalledWith(250);
  });

  it("does not retry permanent query or response-header errors", async () => {
    const query = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "TypeError: fetch failed", details: "UND_ERR_HEADERS_OVERFLOW" },
    });

    const result = await runRemoteQuery({ label: "roles", query, wait: vi.fn() });

    expect(query).toHaveBeenCalledTimes(1);
    expect(result.error).not.toBeNull();
    expect(isTransientRemoteError(result.error)).toBe(false);
  });

  it("includes nested causes in diagnostics", () => {
    const error = new TypeError("fetch failed", {
      cause: Object.assign(new Error("socket reset"), { code: "ECONNRESET" }),
    });
    expect(describeRemoteError(error)).toContain("socket reset");
    expect(describeRemoteError(error)).toContain("fetch failed");
  });

  it("allows legitimately empty props but blocks failed required enrichment", () => {
    const healthy = {
      canonicalPlayersComplete: true,
      updatesComplete: true,
      depthQueryFailures: 0,
      historyQueryFailures: 0,
      scheduleQueryFailed: false,
      scheduleIsEmpty: false,
      vegasGamesQueryFailed: false,
      propsQueryFailures: 0,
    };
    expect(countRequiredInputFailures(healthy)).toBe(0);
    expect(countRequiredInputFailures({ ...healthy, depthQueryFailures: 1 })).toBe(1);
    expect(countRequiredInputFailures({ ...healthy, propsQueryFailures: 1 })).toBe(1);
  });
});
