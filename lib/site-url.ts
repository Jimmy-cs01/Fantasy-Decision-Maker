const DEVELOPMENT_SITE_URL = "http://localhost:3000";
export const CANONICAL_SITE_URL = "https://jimmygm.com";

interface SiteEnvironment {
  NEXT_PUBLIC_SITE_URL?: string;
  NODE_ENV?: string;
}

function normalizeSiteUrl(value: string) {
  const url = new URL(value.includes("://") ? value : `https://${value}`);
  if (url.hostname === "www.jimmygm.com") url.hostname = "jimmygm.com";
  return url.origin;
}

/** Returns the configured canonical origin without a trailing slash. */
export function getSiteUrl(environment: SiteEnvironment = process.env) {
  const configured = environment.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) return normalizeSiteUrl(configured);
  return environment.NODE_ENV === "production"
    ? CANONICAL_SITE_URL
    : DEVELOPMENT_SITE_URL;
}

export function getAbsoluteSiteUrl(
  path = "/",
  environment: SiteEnvironment = process.env,
) {
  return new URL(path, `${getSiteUrl(environment)}/`).toString();
}
