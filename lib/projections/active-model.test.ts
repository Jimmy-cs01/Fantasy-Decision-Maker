import { describe, expect, it } from "vitest";
import {
  ACTIVE_MODEL_RELATION_FILTER,
  DEFAULT_ACTIVE_PROJECTION_MODEL_VERSION,
  resolveActiveProjectionModelVersion,
  selectActiveProjection,
} from "./active-model";

describe("active projection model selection", () => {
  it("defaults production selection explicitly to the safe model", () => {
    expect(resolveActiveProjectionModelVersion("")).toBe(DEFAULT_ACTIVE_PROJECTION_MODEL_VERSION);
  });

  it("does not let a newer experimental generated_at activate itself", () => {
    const selected = selectActiveProjection([
      { id: "production", generated_at: "2026-08-17T00:00:00Z", model_versions: { version: "v2" } },
      { id: "experiment", generated_at: "2026-08-18T00:00:00Z", model_versions: { version: "v4.0" } },
    ], "v2");
    expect(selected?.id).toBe("production");
  });

  it("allows an explicit, reversible version switch", () => {
    expect(resolveActiveProjectionModelVersion("v3.3")).toBe("v3.3");
    expect(() => resolveActiveProjectionModelVersion("latest")).toThrow(/must be a version/);
  });

  it("uses the database registry relation for production queries", () => {
    expect(ACTIVE_MODEL_RELATION_FILTER).toBe("model_versions.is_active");
  });
});
