import Link from "next/link";
import { Card } from "@/components/ui/card";

export default function PlayerNotFound() {
  return <Card className="mx-auto max-w-3xl text-center">
    <h1 className="text-xl font-bold">Player unavailable</h1>
    <p className="mt-2 text-slate-400">This Sleeper player is not mapped to a Jimmy GM player profile yet.</p>
    <Link className="mt-5 inline-block text-cyan-300" href="/players">Return to players</Link>
  </Card>;
}
