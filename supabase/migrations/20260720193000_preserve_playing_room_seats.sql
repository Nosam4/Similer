-- Leaving the page during an active game must not delete the player's seat.
-- Existing clients may still call leave_room while playing, so keep this guard
-- on the server as well as the client-side Disconnect behavior.

create or replace function public.leave_room(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_room public.rooms%rowtype;
  remaining_count integer;
  next_host uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  select *
  into target_room
  from public.rooms
  where id = p_room_id
  for update;

  if target_room.id is null then
    return;
  end if;

  if target_room.status = 'playing' then
    return;
  end if;

  delete from public.room_players
  where room_id = p_room_id
    and user_id = auth.uid();

  select count(*) into remaining_count
  from public.room_players
  where room_id = p_room_id;

  if remaining_count = 0 then
    delete from public.rooms where id = p_room_id;
    return;
  end if;

  if target_room.host_user_id = auth.uid() then
    select user_id
    into next_host
    from public.room_players
    where room_id = p_room_id
    order by seat_index
    limit 1;

    update public.rooms
    set host_user_id = next_host
    where id = p_room_id;
  end if;
end;
$$;

grant execute on function public.leave_room(uuid) to authenticated;
