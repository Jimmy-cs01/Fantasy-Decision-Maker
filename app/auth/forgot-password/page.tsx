import Link from "next/link";
import { AuthFrame } from "@/components/auth/auth-frame";
import { requestPasswordReset } from "../actions";

const first = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  return (
    <AuthFrame
      eyebrow="Account recovery"
      title="Reset your password"
      description="Supabase will email a secure recovery link to your account address."
      footer={
        <Link className="font-bold text-cyan-300" href="/login">
          Back to Log In
        </Link>
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
      <form action={requestPasswordReset} className="mt-6 space-y-4">
        <label className="block text-sm font-bold text-slate-200">
          Email
          <input
            required
            autoComplete="email"
            name="email"
            type="email"
            placeholder="you@example.com"
            className="mt-1.5 min-h-12 w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-white outline-none placeholder:text-slate-600 focus:border-cyan-400"
          />
        </label>
        <button className="min-h-12 w-full rounded-xl bg-cyan-400 px-4 py-3 font-black text-slate-950 hover:bg-cyan-300">
          Send Reset Link
        </button>
      </form>
    </AuthFrame>
  );
}
