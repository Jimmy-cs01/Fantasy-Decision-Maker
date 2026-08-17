import { describe, expect, it } from "vitest";
import { loginSchema, safeReturnPath, signupSchema } from "./validation";

describe("authentication validation", () => {
  it("validates login credentials", () => {
    expect(
      loginSchema.safeParse({ email: "fan@example.com", password: "secret1" })
        .success,
    ).toBe(true);
    expect(
      loginSchema.safeParse({ email: "not-email", password: "short" }).success,
    ).toBe(false);
  });

  it("requires matching signup passwords", () => {
    expect(
      signupSchema.safeParse({
        email: "fan@example.com",
        password: "secret1",
        confirmPassword: "secret1",
      }).success,
    ).toBe(true);
    expect(
      signupSchema.safeParse({
        email: "fan@example.com",
        password: "secret1",
        confirmPassword: "different",
      }).success,
    ).toBe(false);
  });

  it("preserves only local return URLs", () => {
    expect(safeReturnPath("/players?season=2025")).toBe("/players?season=2025");
    expect(safeReturnPath("https://malicious.example")).toBe("/dashboard");
    expect(safeReturnPath("//malicious.example")).toBe("/dashboard");
    expect(safeReturnPath("/\\malicious.example")).toBe("/dashboard");
  });
});
