"use client";

export default function TradesError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto max-w-3xl rounded-2xl border border-red-400/20 bg-red-400/5 p-6 text-center">
      <p className="text-xs font-black tracking-[0.2em] text-red-300">
        TRADE FINDER
      </p>
      <h1 className="mt-2 text-2xl font-black">
        League data is temporarily unavailable
      </h1>
      <p className="mt-2 text-sm text-slate-400">
        Your synchronized data was not changed. Retry the required league and
        roster lookup.
      </p>
      <button
        onClick={reset}
        className="mt-5 rounded-lg bg-cyan-400 px-4 py-2 font-black text-slate-950"
      >
        Retry
      </button>
    </div>
  );
}
