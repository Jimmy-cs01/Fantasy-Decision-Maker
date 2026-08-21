import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthFrame } from "@/components/auth/auth-frame";
import { safeReturnPath } from "@/lib/auth/validation";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { signUp } from "../auth/actions";
import { PasswordInput } from "@/components/auth/password-input";

const first = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const next = safeReturnPath(first(params.next));
  if (!isSupabaseConfigured())
    return (
      <AuthFrame
        eyebrow="Setup required"
        title="Configure Supabase first"
        description="Add your project URL and anonymous key before creating an account."
        footer={
          <Link className="font-bold text-cyan-300" href="/">
            Back home
          </Link>
        }
      >
        <p className="mt-6 rounded-xl border border-slate-700 bg-slate-950/60 p-4 text-sm leading-6 text-slate-300">
          Copy <code>.env.example</code> to <code>.env.local</code>, add your
          credentials, and apply the database migrations.
        </p>
      </AuthFrame>
    );

  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (user) redirect(next);

  return (
    <AuthFrame
      eyebrow="New account"
      title="Create your workspace"
      description="Start with your account, then connect a Sleeper league from the dashboard."
      footer={
        <>
          Already have an account?{" "}
          <Link
            className="font-bold text-cyan-300 hover:text-cyan-200"
            href={`/login?next=${encodeURIComponent(next)}`}
          >
            Log In
          </Link>
        </>
      }
    >
      {first(params.error) && (
        <p
          role="alert"
          className="mt-5 rounded-lg border border-red-400/20 bg-red-500/10 p-3 text-sm text-red-200"
        >
          {first(params.error)}
        </p>
      )}
      <form action={signUp} className="mt-6 space-y-4">
        <input type="hidden" name="next" value={next} />
        <label className="block text-sm font-bold text-slate-200">
          Email
          <input
            required
            autoComplete="email"
            name="email"
            type="email"
            placeholder="you@example.com"
            className="mt-1.5 min-h-12 w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-white transition outline-none placeholder:text-slate-600 focus:border-cyan-400"
          />
        </label>
        <label className="block text-sm font-bold text-slate-200">
          Password
          <PasswordInput
            required
            autoComplete="new-password"
            name="password"
            minLength={6}
            placeholder="At least 6 characters"
          />
        </label>
        <label className="block text-sm font-bold text-slate-200">
          Confirm password
          <PasswordInput
            required
            autoComplete="new-password"
            name="confirmPassword"
            minLength={6}
            placeholder="Repeat your password"
          />
        </label>
        <button className="min-h-12 w-full rounded-xl bg-cyan-400 px-4 py-3 font-black text-slate-950 transition hover:bg-cyan-300">
          Create Account
        </button>
      </form>
    </AuthFrame>
  );
}
