alter table public.rooms
alter column max_players set default 8;

drop function if exists public.create_room(text);

create or replace function public.create_room(
  p_display_name text default 'Player',
  p_max_players integer default 8
)
returns table (room_id uuid, room_code text, seat_index integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_name text;
  clean_max_players integer;
  generated_code text;
  generated_room_id uuid;
  tries integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  clean_name := left(coalesce(nullif(trim(p_display_name), ''), 'Player'), 32);
  clean_max_players := least(8, greatest(2, coalesce(p_max_players, 8)));

  loop
    tries := tries + 1;
    generated_code := public.generate_room_code();

    begin
      insert into public.rooms (code, host_user_id, status, max_players)
      values (generated_code, auth.uid(), 'waiting', clean_max_players)
      returning id into generated_room_id;
      exit;
    exception when unique_violation then
      if tries >= 25 then
        raise exception 'Could not generate a unique room code.';
      end if;
    end;
  end loop;

  insert into public.room_players (room_id, user_id, display_name, seat_index, is_ready)
  values (generated_room_id, auth.uid(), clean_name, 0, false);

  insert into public.room_states (room_id, version, state_json, updated_by)
  values (generated_room_id, 1, '{}'::jsonb, auth.uid());

  return query
  select generated_room_id, generated_code, 0;
end;
$$;

grant execute on function public.create_room(text, integer) to authenticated;
