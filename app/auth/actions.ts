"use server";
import { z } from "zod";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function signInWithPassword(formData: FormData) { const parsed = z.object({ email: z.email(), password: z.string().min(6) }).safeParse(Object.fromEntries(formData)); if (!parsed.success) redirect("/auth?error=Enter+a+valid+email+and+password."); const supabase = await createClient(); const { error } = await supabase.auth.signInWithPassword(parsed.data); if (error) redirect(`/auth?error=${encodeURIComponent(error.message)}`); redirect("/dashboard"); }
export async function signUp(formData: FormData) { const parsed = z.object({ email: z.email(), password: z.string().min(6) }).safeParse(Object.fromEntries(formData)); if (!parsed.success) redirect("/auth?error=Use+a+valid+email+and+a+6%2B+character+password."); const supabase = await createClient(); const { error } = await supabase.auth.signUp(parsed.data); if (error) redirect(`/auth?error=${encodeURIComponent(error.message)}`); redirect("/auth?message=Check+your+email+to+confirm+your+account."); }
export async function signOut() { const supabase = await createClient(); await supabase.auth.signOut(); redirect("/"); }
