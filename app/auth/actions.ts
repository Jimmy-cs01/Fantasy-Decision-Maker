"use server";

import { redirect } from "next/navigation";
import { loginSchema, safeReturnPath, signupSchema } from "@/lib/auth/validation";
import { createClient } from "@/lib/supabase/server";

function redirectWithError(route: "/auth" | "/signup", message: string, next: string): never {
  const query = new URLSearchParams({ error: message, next });
  redirect(`${route}?${query}`);
}

export async function signInWithPassword(formData: FormData) {
  const parsed = loginSchema.safeParse(Object.fromEntries(formData));
  const next = safeReturnPath(formData.get("next"));
  if (!parsed.success) redirectWithError("/auth", "Enter a valid email and a password of at least 6 characters.", next);
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email: parsed.data.email, password: parsed.data.password });
  if (error) redirectWithError("/auth", error.message, next);
  redirect(next);
}

export async function signUp(formData: FormData) {
  const parsed = signupSchema.safeParse(Object.fromEntries(formData));
  const next = safeReturnPath(formData.get("next"));
  if (!parsed.success) {
    const mismatch = formData.get("password") !== formData.get("confirmPassword");
    redirectWithError("/signup", mismatch ? "Passwords must match." : "Use a valid email and a password of at least 6 characters.", next);
  }
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({ email: parsed.data.email, password: parsed.data.password });
  if (error) redirectWithError("/signup", error.message, next);
  if (data.session) redirect(next);
  const query = new URLSearchParams({ message: "Check your email to confirm your account.", next });
  redirect(`/auth?${query}`);
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}
