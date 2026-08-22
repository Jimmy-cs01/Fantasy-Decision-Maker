import { describe, expect, it } from "vitest";
import { activeProbability, availabilityAdjustedPpg, availabilityAdjustedQuantile, calculateAvailability, calculateWeeklyAvailability } from "./availability";
import { projectionAbsencePolicy } from "./policy";
import type { InjuryRecord } from "./types";

const now = new Date("2026-09-01T12:00:00Z");
const injury = (status: InjuryRecord["status"], overrides: Partial<InjuryRecord> = {}): InjuryRecord => ({
  player_id: "p1", status, source: "sleeper", fetched_at: now.toISOString(), ...overrides,
});

describe("canonical injury availability", () => {
  it("retains healthy active-game PPG and expected games", () => {
    const result = calculateAvailability(injury("healthy"), 14, now);
    expect(result.currentWeekActiveProbability).toBe(1);
    expect(result.expectedActiveGamesRemaining).toBe(14);
    expect(availabilityAdjustedPpg(18, result)).toBe(18);
  });

  it("uses calibrated Questionable practice probabilities", () => {
    expect(activeProbability(injury("questionable", { practice_participation: "Full Participation" }), now)).toBe(0.716);
    expect(activeProbability(injury("questionable", { practice_participation: "Limited" }), now)).toBe(0.632);
    expect(activeProbability(injury("questionable", { practice_participation: "DNP" }), now)).toBe(0.419);
    const result = calculateAvailability(injury("questionable", { practice_participation: "Limited" }), 14, now);
    expect(availabilityAdjustedPpg(18, result)).toBeCloseTo(11.376);
    expect(result.expectedActiveGamesRemaining).toBeCloseTo(13.632);
  });

  it("surfaces preseason Questionable status without suppressing a game more than seven days away", () => {
    const result = calculateAvailability(injury("questionable"), 14, now, "2026-09-15T00:00:00Z");
    expect(result.status).toBe("questionable");
    expect(result.currentWeekActiveProbability).toBe(1);
    expect(result.expectedActiveGamesRemaining).toBe(14);
  });

  it("does not treat a stale reserve label on an active roster as a structural absence", () => {
    const result = calculateAvailability(injury("pup", { roster_status: "Active" }), 14, now, "2026-09-15T00:00:00Z");
    expect(result.status).toBe("pup");
    expect(result.currentWeekActiveProbability).toBe(1);
  });

  it("sets confirmed Out weekly PPG to zero without destroying active talent", () => {
    const result = calculateAvailability(injury("out", { expected_games_missed: 1, timeline_type: "reported" }), 14, now);
    expect(result.currentWeekActiveProbability).toBe(0);
    expect(result.expectedActiveGamesRemaining).toBe(13);
    expect(availabilityAdjustedPpg(20, result)).toBe(0);
  });

  it("materially reduces an eight-week absence and season-ending absence", () => {
    expect(calculateAvailability(injury("ir", { expected_games_missed: 8 }), 14, now).expectedActiveGamesRemaining).toBe(6);
    expect(calculateAvailability(injury("ir", { expected_games_missed: 20 }), 14, now).expectedActiveGamesRemaining).toBe(0);
  });

  it("centralizes projection-only fallback weeks without presenting them as reported timetables", () => {
    expect(projectionAbsencePolicy(injury("questionable"))).toMatchObject({ weeks: 0, basis: "none" });
    expect(projectionAbsencePolicy(injury("out"))).toMatchObject({ weeks: 1, basis: "jimmygm_fallback" });
    expect(projectionAbsencePolicy(injury("pup"))).toMatchObject({ weeks: 4, basis: "jimmygm_fallback" });
    expect(projectionAbsencePolicy(injury("ir"))).toMatchObject({ weeks: 4, basis: "jimmygm_fallback" });
    const reserve = calculateAvailability(injury("ir"), 14, now);
    expect(reserve.timelineLabel).toBe("Return timetable unknown");
    expect(reserve.projectionAssumption).toBe("JimmyGM projection assumption: 4 weeks");
  });

  it("applies fallback absences by week and lets a reliable reported return override them", () => {
    expect(calculateWeeklyAvailability(injury("out"), 1, 1, 17, now).currentWeekActiveProbability).toBe(0);
    expect(calculateWeeklyAvailability(injury("out"), 2, 1, 16, now).currentWeekActiveProbability).toBe(1);
    expect(calculateWeeklyAvailability(injury("pup"), 4, 1, 14, now).currentWeekActiveProbability).toBe(0);
    expect(calculateWeeklyAvailability(injury("pup"), 5, 1, 13, now).currentWeekActiveProbability).toBe(1);
    const reported = injury("out", { expected_return_date: "2026-09-20", expected_games_missed: 2, timeline_type: "reported" });
    expect(calculateWeeklyAvailability(reported, 2, 1, 16, now, "2026-09-15T17:00:00Z").currentWeekActiveProbability).toBe(0);
    expect(calculateWeeklyAvailability(reported, 3, 1, 15, now, "2026-09-22T17:00:00Z").currentWeekActiveProbability).toBe(1);
  });

  it("does not silently penalize stale injury data", () => {
    const result = calculateAvailability(injury("out", { fetched_at: "2026-08-01T00:00:00Z" }), 14, now);
    expect(result.isStale).toBe(true);
    expect(result.currentWeekActiveProbability).toBe(1);
    expect(result.expectedActiveGamesRemaining).toBe(14);
  });

  it("models availability as a zero-or-active mixture distribution", () => {
    const availability = calculateAvailability(injury("questionable", { practice_participation: "Limited" }), 14, now);
    expect(availabilityAdjustedQuantile(0.2, availability, 10, 18, 26)).toBe(0);
    expect(availabilityAdjustedQuantile(0.8, availability, 10, 18, 26)).toBeGreaterThan(18);
  });
});
