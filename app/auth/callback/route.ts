import { NextResponse } from "next/server";
import { friendlyAuthError } from "@/lib/auth/errors";
import { safeReturnPath } from "@/lib/auth/validation";
import { getAbsoluteSiteUrl } from "@/lib/site-url";
import { createClient } from "@/lib/supabase/server";

function authRedirect(path: string) {
  return NextResponse.redirect(getAbsoluteSiteUrl(path));
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const next = safeReturnPath(requestUrl.searchParams.get("next"));
  const providerError =
    requestUrl.searchParams.get("error_code") ??
    requestUrl.searchParams.get("error_description") ??
    requestUrl.searchParams.get("error");
  if (providerError) {
    const query = new URLSearchParams({
      error: friendlyAuthError(providerError),
      next,
    });
    return authRedirect(`/login?${query}`);
  }

  const code = requestUrl.searchParams.get("code");
  if (!code) {
    const query = new URLSearchParams({
      error: "This authentication link is invalid or has expired.",
      next,
    });
    return authRedirect(`/login?${query}`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    const query = new URLSearchParams({
      error: friendlyAuthError(error),
      next,
    });
    return authRedirect(`/login?${query}`);
  }
  return authRedirect(next);
}
