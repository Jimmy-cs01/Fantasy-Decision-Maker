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
    /error sending confirmation email|unexpected_failure.*email|smtp|sending.*email/i,
    "JimmyGM could not send the confirmation email. Please try again shortly; if this continues, the email service needs attention.",
  ],
  [/user_already_exists|already.*registered/i, "An account already exists for this email. Log in or reset your password."],
  [/weak_password|password.*weak/i, "Choose a stronger password with a mix of letters, numbers, and symbols."],
  [/email_address_invalid|invalid.*email/i, "Enter a valid email address."],
  [/signup_disabled/i, "New account registration is temporarily unavailable."],
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

export function authErrorDiagnostics(error: unknown) {
  if (!error || typeof error !== "object") return { name: "UnknownAuthError" };
  return {
    name: "name" in error ? String(error.name) : "AuthError",
    code: "code" in error ? String(error.code) : null,
    status: "status" in error ? Number(error.status) : null,
    message: "message" in error ? String(error.message) : "Unknown authentication failure",
  };
}
