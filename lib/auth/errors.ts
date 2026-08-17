const AUTH_ERROR_MESSAGES: Array<[RegExp, string]> = [
  [/email[_ ]not[_ ]confirmed/i, "Confirm your email before logging in."],
  [
    /otp[_ ]expired|token.*expired|expired.*link/i,
    "This email link has expired. Request a new one and try again.",
  ],
  [
    /rate.*exceed|over_email_send_rate_limit|too many requests/i,
    "Too many email requests were made. Wait a moment before trying again.",
  ],
  [
    /error sending confirmation email|smtp|sending.*email/i,
    "We could not send the authentication email. Please try again shortly.",
  ],
  [/access_denied/i, "That authentication request was denied or cancelled."],
  [/invalid login credentials/i, "The email or password is incorrect."],
];

export function friendlyAuthError(error: unknown) {
  const source =
    error && typeof error === "object"
      ? `${"code" in error ? String(error.code) : ""} ${"message" in error ? String(error.message) : ""}`
      : String(error ?? "");
  return (
    AUTH_ERROR_MESSAGES.find(([pattern]) => pattern.test(source))?.[1] ??
    "Authentication could not be completed. Please try again."
  );
}
