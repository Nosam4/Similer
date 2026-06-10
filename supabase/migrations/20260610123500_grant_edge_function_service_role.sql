-- The game-action Edge Function uses the service role key to apply authoritative
-- game transitions. Service role bypasses RLS, but still needs table privileges.

grant usage on schema public to service_role;

grant select, update on public.rooms to service_role;
grant select on public.room_players to service_role;
grant select, insert, update, delete on public.room_states to service_role;
grant select, insert, update, delete on public.hand_words to service_role;
grant select, insert, update, delete on public.showdown_votes to service_role;
