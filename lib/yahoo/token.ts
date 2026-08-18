export interface YahooTokenResponse {
  access_token: string; refresh_token?: string; expires_in: number; token_type: string;
  xoauth_yahoo_guid?: string; scope?: string;
}

export function parseYahooTokenResponse(payload: unknown): YahooTokenResponse {
  if (!payload || typeof payload !== "object") throw new Error("Yahoo returned a malformed token response.");
  const value = payload as Record<string, unknown>; const expires = Number(value.expires_in);
  if (typeof value.access_token !== "string" || !value.access_token || !Number.isFinite(expires) || expires <= 0) throw new Error("Yahoo returned a malformed token response.");
  return { access_token: value.access_token, refresh_token: typeof value.refresh_token === "string" ? value.refresh_token : undefined,
    expires_in: expires, token_type: typeof value.token_type === "string" ? value.token_type : "bearer",
    xoauth_yahoo_guid: typeof value.xoauth_yahoo_guid === "string" ? value.xoauth_yahoo_guid : undefined,
    scope: typeof value.scope === "string" ? value.scope : undefined };
}
