import { afterEach, describe, expect, it } from "vitest";
import { isAdminIdentity } from "./admin";

const previous = process.env.ADMIN_EMAILS;

afterEach(() => {
  if (previous === undefined) delete process.env.ADMIN_EMAILS;
  else process.env.ADMIN_EMAILS = previous;
});

describe("admin authorization", () => {
  it("denies guests and ordinary registered users", () => {
    process.env.ADMIN_EMAILS = "admin@example.com";
    expect(isAdminIdentity(null)).toBe(false);
    expect(isAdminIdentity({ email: "member@example.com", app_metadata: {} })).toBe(false);
  });

  it("accepts an explicit admin role or configured admin email", () => {
    process.env.ADMIN_EMAILS = "admin@example.com";
    expect(isAdminIdentity({ email: "admin@example.com", app_metadata: {} })).toBe(true);
    expect(isAdminIdentity({ email: "other@example.com", app_metadata: { role: "admin" } })).toBe(true);
  });
});
