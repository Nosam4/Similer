create or replace function public.join_room(
  p_room_code text,
  p_display_name text default 'Player'
)
returns table (
  room_id uuid,
  room_code text,
  seat_index integer,
  host_user_id uuid,
  status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_name text;
  target_room public.rooms%rowtype;
  existing_row public.room_players%rowtype;
  chosen_seat integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  clean_name := left(coalesce(nullif(trim(p_display_name), ''), 'Player'), 32);

  select *
  into target_room
  from public.rooms
  where public.rooms.code = upper(trim(p_room_code))
  for update;

  if target_room.id is null then
    raise exception 'Room not found.';
  end if;

  select room_players.*
  into existing_row
  from public.room_players as room_players
  where room_players.room_id = target_room.id
    and room_players.user_id = auth.uid();

  if existing_row.user_id is not null then
    update public.room_players as room_players
    set display_name = clean_name
    where room_players.room_id = existing_row.room_id
      and room_players.user_id = existing_row.user_id;

    return query
    select
      target_room.id,
      target_room.code,
      existing_row.seat_index,
      target_room.host_user_id,
      target_room.status;
    return;
  end if;

  if target_room.status <> 'waiting' then
    raise exception 'Room is not accepting new players.';
  end if;

  if (
    select count(*)
    from public.room_players player_row
    where player_row.room_id = target_room.id
  ) >= target_room.max_players then
    raise exception 'Room is full.';
  end if;

  select seat_num
  into chosen_seat
  from generate_series(0, target_room.max_players - 1) as seat_num
  where not exists (
    select 1
    from public.room_players player_row
    where player_row.room_id = target_room.id
      and player_row.seat_index = seat_num
  )
  order by seat_num
  limit 1;

  if chosen_seat is null then
    raise exception 'No open seat available.';
  end if;

  insert into public.room_players (room_id, user_id, display_name, seat_index, is_ready)
  values (target_room.id, auth.uid(), clean_name, chosen_seat, false);

  return query
  select
    target_room.id,
    target_room.code,
    chosen_seat,
    target_room.host_user_id,
    target_room.status;
end;
$$;
