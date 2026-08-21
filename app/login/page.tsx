import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthFrame } from "@/components/auth/auth-frame";
import { safeReturnPath } from "@/lib/auth/validation";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { signInWithPassword } from "../auth/actions";
import { PasswordInput } from "@/components/auth/password-input";

const first = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

export default async function LoginPage({
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
        description="Add your project URL and anonymous key before signing in."
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
      eyebrow="Existing account"
      title="Welcome back"
      description="Log in to open your synced leagues and player workspace."
      footer={
        <>
          Don&apos;t have an account?{" "}
          <Link
            className="font-bold text-cyan-300 hover:text-cyan-200"
            href={`/signup?next=${encodeURIComponent(next)}`}
          >
            Create Account
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
      {first(params.message) && (
        <p className="mt-5 rounded-lg border border-emerald-400/20 bg-emerald-500/10 p-3 text-sm text-emerald-200">
          {first(params.message)}
        </p>
      )}
      <form action={signInWithPassword} className="mt-6 space-y-4">
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
            autoComplete="current-password"
            name="password"
            minLength={6}
            placeholder="Your password"
          />
        </label>
        <div className="text-right">
          <Link
            href="/auth/forgot-password"
            className="text-sm font-bold text-cyan-300 hover:text-cyan-200"
          >
            Forgot password?
          </Link>
        </div>
        <button className="min-h-12 w-full rounded-xl bg-cyan-400 px-4 py-3 font-black text-slate-950 transition hover:bg-cyan-300">
          Log In
        </button>
      </form>
      <div className="my-5 flex items-center gap-3 text-xs font-bold uppercase tracking-widest text-slate-600">
        <span className="h-px flex-1 bg-slate-800" /> or <span className="h-px flex-1 bg-slate-800" />
      </div>
      <Link
        href="/guest"
        className="flex min-h-12 w-full items-center justify-center rounded-xl border border-cyan-400/40 bg-cyan-400/5 px-4 py-3 font-black text-cyan-200 transition hover:border-cyan-300 hover:bg-cyan-400/10"
      >
        Continue as Guest
      </Link>
      <p className="mt-2 text-center text-xs leading-5 text-slate-500">
        Try public Sleeper league tools for this browser session. Nothing is saved to a Jimmy GM account.
      </p>
    </AuthFrame>
  );
}
