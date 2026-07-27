-- Persist authoritative room state and its idempotency receipt in one database
-- transaction. This removes a sequential Edge Function round trip and ensures
-- an accepted state transition can always be recovered after a lost response.

create or replace function public.commit_game_action(
  p_room_id uuid,
  p_actor_user_id uuid,
  p_command_id uuid,
  p_action_type text,
  p_payload jsonb,
  p_expected_version integer,
  p_state_json jsonb,
  p_updated_by uuid,
  p_next_status text default null,
  p_public_reveal_player_ids integer[] default array[]::integer[]
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  current_state public.room_states%rowtype;
  saved_state public.room_states%rowtype;
  target_room public.rooms%rowtype;
  prior_action public.room_actions%rowtype;
  response_body jsonb;
begin
  if p_room_id is null or p_actor_user_id is null or p_updated_by is null then
    raise exception 'Room, actor, and updating user are required.';
  end if;

  if p_command_id is null or trim(coalesce(p_action_type, '')) = '' then
    raise exception 'Command id and action type are required.';
  end if;

  if p_expected_version is null or p_expected_version < 1 then
    raise exception 'A valid expected room-state version is required.';
  end if;

  if jsonb_typeof(coalesce(p_state_json, '{}'::jsonb)) <> 'object' then
    raise exception 'The next room state must be a JSON object.';
  end if;

  if p_next_status is not null and p_next_status not in ('waiting', 'playing', 'finished') then
    raise exception 'Invalid next room status.';
  end if;

  select *
  into current_state
  from public.room_states
  where room_id = p_room_id
  for update;

  if current_state.room_id is null then
    raise exception 'Room state not found.';
  end if;

  -- Recheck after taking the room-state lock so a concurrent retry can recover
  -- the first transaction's response instead of reporting a version conflict.
  select *
  into prior_action
  from public.room_actions
  where room_id = p_room_id
    and actor_user_id = p_actor_user_id
    and command_id = p_command_id
    and accepted
    and response_json is not null
  order by id desc
  limit 1;

  if prior_action.id is not null then
    if prior_action.action_type <> p_action_type then
      raise exception 'Command id was already used for another command.';
    end if;

    return jsonb_build_object(
      'response', prior_action.response_json,
      'replayed', true
    );
  end if;

  if current_state.version <> p_expected_version then
    raise exception 'Room state changed on another device. Please try again.';
  end if;

  update public.room_states
  set
    version = p_expected_version + 1,
    state_json = p_state_json,
    updated_by = p_updated_by
  where room_id = p_room_id
    and version = p_expected_version
  returning * into saved_state;

  if saved_state.room_id is null then
    raise exception 'Room state changed on another device. Please try again.';
  end if;

  if p_next_status is not null then
    update public.rooms
    set status = p_next_status
    where id = p_room_id
    returning * into target_room;
  else
    select *
    into target_room
    from public.rooms
    where id = p_room_id;
  end if;

  if target_room.id is null then
    raise exception 'Room not found.';
  end if;

  if coalesce(array_length(p_public_reveal_player_ids, 1), 0) > 0 then
    update public.hand_words
    set is_revealed = true
    where room_id = p_room_id
      and hand_number = nullif(p_state_json ->> 'handNumber', '')::integer
      and player_id = any(p_public_reveal_player_ids);
  end if;

  response_body := jsonb_build_object(
    'roomState', to_jsonb(saved_state),
    'room', to_jsonb(target_room)
  );

  insert into public.room_actions (
    room_id,
    actor_user_id,
    action_type,
    payload,
    accepted,
    error_text,
    version_before,
    version_after,
    command_id,
    response_json
  )
  values (
    p_room_id,
    p_actor_user_id,
    p_action_type,
    coalesce(p_payload, '{}'::jsonb),
    true,
    null,
    p_expected_version,
    saved_state.version,
    p_command_id,
    response_body
  );

  return jsonb_build_object(
    'response', response_body,
    'replayed', false
  );
end;
$$;

create or replace function public.deal_catalog_hand_and_record_action(
  p_room_id uuid,
  p_hand_number integer,
  p_expected_version integer,
  p_player_ids integer[],
  p_state_json jsonb,
  p_updated_by uuid,
  p_next_status text,
  p_embedding_model text,
  p_actor_user_id uuid,
  p_command_id uuid,
  p_action_type text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  deal_result jsonb;
  response_body jsonb;
  prior_action public.room_actions%rowtype;
  inserted_count integer;
begin
  if p_actor_user_id is null or p_command_id is null or trim(coalesce(p_action_type, '')) = '' then
    raise exception 'Actor, command id, and action type are required.';
  end if;

  select *
  into prior_action
  from public.room_actions
  where room_id = p_room_id
    and actor_user_id = p_actor_user_id
    and command_id = p_command_id
    and accepted
    and response_json is not null
  order by id desc
  limit 1;

  if prior_action.id is not null then
    if prior_action.action_type <> p_action_type then
      raise exception 'Command id was already used for another command.';
    end if;

    return jsonb_build_object(
      'response', prior_action.response_json,
      'replayed', true
    );
  end if;

  deal_result := public.deal_catalog_hand(
    p_room_id,
    p_hand_number,
    p_expected_version,
    p_player_ids,
    p_state_json,
    p_updated_by,
    p_next_status,
    p_embedding_model
  );

  response_body := jsonb_build_object(
    'roomState', deal_result -> 'roomState',
    'room', deal_result -> 'room'
  );

  insert into public.room_actions (
    room_id,
    actor_user_id,
    action_type,
    payload,
    accepted,
    error_text,
    version_before,
    version_after,
    command_id,
    response_json
  )
  values (
    p_room_id,
    p_actor_user_id,
    p_action_type,
    coalesce(p_payload, '{}'::jsonb),
    true,
    null,
    p_expected_version,
    (deal_result -> 'roomState' ->> 'version')::integer,
    p_command_id,
    response_body
  )
  on conflict (room_id, actor_user_id, command_id)
    where command_id is not null
  do nothing;

  get diagnostics inserted_count = row_count;

  if inserted_count = 0 then
    select *
    into prior_action
    from public.room_actions
    where room_id = p_room_id
      and actor_user_id = p_actor_user_id
      and command_id = p_command_id
      and accepted
      and response_json is not null
    order by id desc
    limit 1;

    if prior_action.id is null then
      raise exception 'Unable to recover command receipt.';
    end if;

    if prior_action.action_type <> p_action_type then
      raise exception 'Command id was already used for another command.';
    end if;

    return jsonb_build_object(
      'response', prior_action.response_json,
      'replayed', true
    );
  end if;

  return jsonb_build_object(
    'response', response_body,
    'replayed', coalesce((deal_result ->> 'idempotent')::boolean, false)
  );
end;
$$;

revoke all on function public.commit_game_action(uuid, uuid, uuid, text, jsonb, integer, jsonb, uuid, text, integer[]) from public;
revoke all on function public.commit_game_action(uuid, uuid, uuid, text, jsonb, integer, jsonb, uuid, text, integer[]) from anon;
revoke all on function public.commit_game_action(uuid, uuid, uuid, text, jsonb, integer, jsonb, uuid, text, integer[]) from authenticated;
grant execute on function public.commit_game_action(uuid, uuid, uuid, text, jsonb, integer, jsonb, uuid, text, integer[]) to service_role;

revoke all on function public.deal_catalog_hand_and_record_action(uuid, integer, integer, integer[], jsonb, uuid, text, text, uuid, uuid, text, jsonb) from public;
revoke all on function public.deal_catalog_hand_and_record_action(uuid, integer, integer, integer[], jsonb, uuid, text, text, uuid, uuid, text, jsonb) from anon;
revoke all on function public.deal_catalog_hand_and_record_action(uuid, integer, integer, integer[], jsonb, uuid, text, text, uuid, uuid, text, jsonb) from authenticated;
grant execute on function public.deal_catalog_hand_and_record_action(uuid, integer, integer, integer[], jsonb, uuid, text, text, uuid, uuid, text, jsonb) to service_role;

comment on function public.commit_game_action(uuid, uuid, uuid, text, jsonb, integer, jsonb, uuid, text, integer[]) is
  'Atomically persists an authoritative room-state transition, public word reveals, room status, and successful idempotency receipt.';

comment on function public.deal_catalog_hand_and_record_action(uuid, integer, integer, integer[], jsonb, uuid, text, text, uuid, uuid, text, jsonb) is
  'Atomically deals a catalog hand and records the successful idempotency receipt returned to the client.';
