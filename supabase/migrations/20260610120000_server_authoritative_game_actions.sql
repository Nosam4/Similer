-- Online gameplay now flows through the `game-action` Edge Function.
-- Authenticated browser clients may read room state, but they should not be able
-- to forge a full state_json update or replace private hand words directly.

revoke insert, update on public.room_states from authenticated;
revoke insert, update on public.room_states from public;

-- Keep read access, but remove direct client write policies for authoritative state.
drop policy if exists "room members can update state" on public.room_states;
drop policy if exists "room members can insert state" on public.room_states;

-- These RPCs were useful for the client-authoritative prototype. The Edge Function
-- now owns private dealing and final vote resolution.
revoke execute on function public.replace_hand_words(uuid, integer, jsonb) from authenticated;
revoke execute on function public.replace_hand_words(uuid, integer, jsonb) from public;
revoke execute on function public.get_showdown_votes_for_resolution(uuid, integer) from authenticated;
revoke execute on function public.get_showdown_votes_for_resolution(uuid, integer) from public;
