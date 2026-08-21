import Link from "next/link";
import { AuthFrame } from "@/components/auth/auth-frame";
import { updatePassword } from "../actions";
import { PasswordInput } from "@/components/auth/password-input";

const first = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

export default async function UpdatePasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  return (
    <AuthFrame
      eyebrow="Account recovery"
      title="Choose a new password"
      description="Your recovery session must still be valid to update the account."
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
      <form action={updatePassword} className="mt-6 space-y-4">
        <label className="block text-sm font-bold text-slate-200">
          New password
          <PasswordInput
            required
            autoComplete="new-password"
            name="password"
            minLength={6}
          />
        </label>
        <label className="block text-sm font-bold text-slate-200">
          Confirm password
          <PasswordInput
            required
            autoComplete="new-password"
            name="confirmPassword"
            minLength={6}
          />
        </label>
        <button className="min-h-12 w-full rounded-xl bg-cyan-400 px-4 py-3 font-black text-slate-950 hover:bg-cyan-300">
          Update Password
        </button>
      </form>
    </AuthFrame>
  );
}
