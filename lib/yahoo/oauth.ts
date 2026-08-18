import "server-only";
import { decryptYahooToken, encryptYahooToken } from "./crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseYahooTokenResponse, type YahooTokenResponse } from "./token";

const AUTHORIZATION_ENDPOINT = "https://api.login.yahoo.com/oauth2/request_auth";
const TOKEN_ENDPOINT = "https://api.login.yahoo.com/oauth2/get_token";

function yahooConfig() {
  const clientId = process.env.YAHOO_CLIENT_ID;
  const clientSecret = process.env.YAHOO_CLIENT_SECRET;
  const redirectUri = process.env.YAHOO_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) throw new Error("Yahoo OAuth is not configured.");
  return { clientId, clientSecret, redirectUri };
}

export function yahooAuthorizationUrl(state: string) {
  const { clientId, redirectUri } = yahooConfig();
  const url = new URL(AUTHORIZATION_ENDPOINT);
  url.search = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: "code", state }).toString();
  return url;
}

async function tokenRequest(body: URLSearchParams): Promise<YahooTokenResponse> {
  const { clientId, clientSecret } = yahooConfig();
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST", signal: AbortSignal.timeout(8_000),
    headers: { Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" }, body,
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Yahoo OAuth token exchange failed (${response.status}).`);
  return parseYahooTokenResponse(await response.json());
}

export function exchangeYahooCode(code: string) {
  const { redirectUri } = yahooConfig();
  return tokenRequest(new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri }));
}

export function refreshYahooToken(refreshToken: string) {
  const { redirectUri } = yahooConfig();
  return tokenRequest(new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, redirect_uri: redirectUri }));
}

export async function saveYahooAccount(userId: string, token: YahooTokenResponse, existingRefreshToken?: string) {
  const providerUserId = token.xoauth_yahoo_guid;
  if (!providerUserId) throw new Error("Yahoo did not return an account identifier.");
  const refresh = token.refresh_token ?? existingRefreshToken;
  if (!refresh) throw new Error("Yahoo did not return a refresh token.");
  const admin = createAdminClient();
  const { error } = await admin.from("yahoo_accounts").upsert({
    user_id: userId, provider_user_id: providerUserId,
    access_token_encrypted: encryptYahooToken(token.access_token), refresh_token_encrypted: encryptYahooToken(refresh),
    token_expires_at: new Date(Date.now() + Number(token.expires_in) * 1_000).toISOString(), scopes: token.scope?.split(/\s+/).filter(Boolean) ?? [],
  }, { onConflict: "user_id,provider_user_id" });
  if (error) throw new Error(`Unable to save Yahoo authorization: ${error.message}`);
}

const pendingAccessTokens = new Map<string, Promise<string>>();

async function resolveYahooAccessToken(userId: string) {
  const admin = createAdminClient();
  const { data: account, error } = await admin.from("yahoo_accounts").select("provider_user_id,access_token_encrypted,refresh_token_encrypted,token_expires_at").eq("user_id", userId).limit(1).maybeSingle();
  if (error) throw new Error(`Unable to load Yahoo authorization: ${error.message}`);
  if (!account) throw new Error("Yahoo is not connected.");
  if (new Date(account.token_expires_at).getTime() > Date.now() + 60_000) return decryptYahooToken(account.access_token_encrypted);
  const oldRefresh = decryptYahooToken(account.refresh_token_encrypted);
  try {
    const refreshed = await refreshYahooToken(oldRefresh);
    await saveYahooAccount(userId, { ...refreshed, xoauth_yahoo_guid: account.provider_user_id }, oldRefresh);
    return refreshed.access_token;
  } catch (error) {
    console.warn("Yahoo authorization refresh failed; reconnect is required", { userId, error: error instanceof Error ? error.message : "unknown" });
    throw new Error("Yahoo authorization expired. Reconnect Yahoo to continue.");
  }
}

export function getYahooAccessToken(userId: string) {
  const pending = pendingAccessTokens.get(userId);
  if (pending) return pending;
  const request = resolveYahooAccessToken(userId).finally(() => pendingAccessTokens.delete(userId));
  pendingAccessTokens.set(userId, request);
  return request;
}
