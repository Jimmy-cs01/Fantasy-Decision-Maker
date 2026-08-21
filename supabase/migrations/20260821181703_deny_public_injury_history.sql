create policy "deny anonymous injury history"
on public.player_injury_history for select
to anon
using (false);

create policy "deny authenticated injury history"
on public.player_injury_history for select
to authenticated
using (false);
