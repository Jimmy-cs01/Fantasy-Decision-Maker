import { describe, expect, it } from "vitest";
import { featureForPath, normalizedAuthenticatedPath } from "./features";

describe("authenticated analytics paths", () => {
  it("maps application routes to stable feature labels", () => {
    expect(featureForPath("/dashboard/league/example")).toBe("League dashboard");
    expect(featureForPath("/trades")).toBe("Trade Finder");
    expect(featureForPath("/unknown")).toBe("Other");
  });

  it("does not retain player or league identifiers", () => {
    expect(normalizedAuthenticatedPath("/dashboard/league/private-id")).toBe("/dashboard/league/[leagueId]");
    expect(normalizedAuthenticatedPath("/players/player-id")).toBe("/players/[playerId]");
  });
});
