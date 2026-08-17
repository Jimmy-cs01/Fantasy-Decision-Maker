import { describe, expect, it } from "vitest";
import { friendlyAuthError } from "./errors";

describe("friendly authentication errors", () => {
  it.each([
    ["email_not_confirmed", "Confirm your email"],
    ["otp_expired", "expired"],
    ["over_email_send_rate_limit", "Too many email requests"],
    ["Error sending confirmation email", "could not send"],
    ["access_denied", "denied"],
    ["Invalid login credentials", "incorrect"],
  ])("maps %s without exposing provider details", (providerError, expected) => {
    expect(friendlyAuthError(new Error(providerError))).toContain(expected);
  });
});
