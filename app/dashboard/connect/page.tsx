import { ConnectForm } from "./connect-form";

const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;

export default async function ConnectPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  return <ConnectForm
    initialSleeperUsername={first(query.guestUsername) ?? ""}
    preferredLeagueId={first(query.guestLeagueId) ?? null}
  />;
}
