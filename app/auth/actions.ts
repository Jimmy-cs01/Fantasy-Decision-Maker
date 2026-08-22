"use server";

import { redirect } from "next/navigation";
import { authErrorDiagnostics, friendlyAuthError } from "@/lib/auth/errors";
import { getAuthCallbackUrl, getPasswordRecoveryUrl } from "@/lib/auth/urls";
import {
  loginSchema,
  resetPasswordSchema,
  safeReturnPath,
  signupSchema,
  updatePasswordSchema,
} from "@/lib/auth/validation";
import { createClient } from "@/lib/supabase/server";

function redirectWithError(
  route:
    "/login" | "/signup" | "/auth/forgot-password" | "/auth/update-password",
  message: string,
  next = "/dashboard",
): never {
  const query = new URLSearchParams({ error: message, next });
  redirect(`${route}?${query}`);
}

export async function signInWithPassword(formData: FormData) {
  const parsed = loginSchema.safeParse(Object.fromEntries(formData));
  const next = safeReturnPath(formData.get("next"));
  if (!parsed.success)
    redirectWithError(
      "/login",
      "Enter a valid email and a password of at least 6 characters.",
      next,
    );
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (error) redirectWithError("/login", friendlyAuthError(error), next);
  redirect(next);
}

export async function signUp(formData: FormData) {
  const parsed = signupSchema.safeParse(Object.fromEntries(formData));
  const next = safeReturnPath(formData.get("next"));
  if (!parsed.success) {
    const mismatch =
      formData.get("password") !== formData.get("confirmPassword");
    redirectWithError(
      "/signup",
      mismatch
        ? "Passwords must match."
        : "Use a valid email and a password of at least 6 characters.",
      next,
    );
  }
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: { emailRedirectTo: getAuthCallbackUrl(next) },
  });
  if (error) {
    console.error("Supabase signup failed", authErrorDiagnostics(error));
    redirectWithError("/signup", friendlyAuthError(error), next);
  }
  if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    redirectWithError(
      "/login",
      "An account may already exist for this email. Log in or reset your password.",
      next,
    );
  }
  if (data.session) redirect(next);
  const query = new URLSearchParams({
    message: "Check your email to confirm your account.",
    next,
  });
  redirect(`/login?${query}`);
}

export async function requestPasswordReset(formData: FormData) {
  const parsed = resetPasswordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success)
    redirectWithError("/auth/forgot-password", "Enter a valid email address.");
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(
    parsed.data.email,
    {
      redirectTo: getPasswordRecoveryUrl(),
    },
  );
  if (error)
    redirectWithError("/auth/forgot-password", friendlyAuthError(error));
  redirect(
    "/login?message=If+an+account+exists%2C+a+password+reset+email+was+sent.",
  );
}

export async function updatePassword(formData: FormData) {
  const parsed = updatePasswordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const mismatch =
      formData.get("password") !== formData.get("confirmPassword");
    redirectWithError(
      "/auth/update-password",
      mismatch
        ? "Passwords must match."
        : "Use a password of at least 6 characters.",
    );
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    redirectWithError(
      "/auth/forgot-password",
      "This password-reset session has expired. Request a new email.",
    );
  const { error } = await supabase.auth.updateUser({
    password: parsed.data.password,
  });
  if (error)
    redirectWithError("/auth/update-password", friendlyAuthError(error));
  redirect("/login?message=Password+updated.+You+can+log+in+now.");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}
