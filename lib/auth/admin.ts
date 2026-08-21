export function isAdminIdentity(user: { email?: string | null; app_metadata?: Record<string, unknown> } | null | undefined) {
  if (!user) return false;
  if (user.app_metadata?.role === "admin") return true;
  const allowed = (process.env.ADMIN_EMAILS ?? "").split(",").map((email) => email.trim().toLowerCase()).filter(Boolean);
  return Boolean(user.email && allowed.includes(user.email.toLowerCase()));
}
