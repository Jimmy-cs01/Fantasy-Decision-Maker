import { getAbsoluteSiteUrl } from "../site-url";
import { safeReturnPath } from "./validation";

export function getAuthCallbackUrl(next: unknown = "/dashboard") {
  const url = new URL(getAbsoluteSiteUrl("/auth/callback"));
  url.searchParams.set("next", safeReturnPath(next));
  return url.toString();
}

export function getPasswordRecoveryUrl() {
  return getAuthCallbackUrl("/auth/update-password");
}
