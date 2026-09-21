-- Publish multiplayer tables so subscribed clients receive room and game changes.
-- The frontend still polls lightweight snapshots to cover subscription races.

do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'rooms',
    'room_players',
    'room_states',
    'hand_words',
    'showdown_votes'
  ]
  loop
    if to_regclass(format('public.%I', target_table)) is null then
      raise exception 'Required Realtime table public.% does not exist', target_table;
    end if;

    if not exists (
      select 1
      from pg_catalog.pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = target_table
    ) then
      execute format(
        'alter publication supabase_realtime add table public.%I',
        target_table
      );
    end if;
  end loop;
end
$$;

comment on table public.room_players is
  'Room membership is published through Supabase Realtime and reconciled by a client polling fallback.';
