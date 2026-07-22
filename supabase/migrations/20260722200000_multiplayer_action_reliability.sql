-- Reduce Edge Function round-trips and make successful game commands replayable.
-- The context RPC is service-role-only because it includes private hand words.

alter table public.room_actions
add column if not exists command_id uuid;

alter table public.room_actions
add column if not exists response_json jsonb;

create unique index if not exists room_actions_command_id_idx
on public.room_actions (room_id, actor_user_id, command_id)
where command_id is not null;

create or replace function public.get_game_action_context(
  p_room_id uuid,
  p_actor_user_id uuid,
  p_command_id uuid default null
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $$
  with selected_room as (
    select target_room.*
    from public.rooms as target_room
    where target_room.id = p_room_id
  ),
  selected_state as (
    select target_state.*
    from public.room_states as target_state
    where target_state.room_id = p_room_id
  ),
  selected_hand as (
    select nullif(selected_state.state_json ->> 'handNumber', '')::integer as hand_number
    from selected_state
  )
  select jsonb_build_object(
    'room', (
      select to_jsonb(selected_room)
      from selected_room
    ),
    'roomPlayers', coalesce(
      (
        select jsonb_agg(to_jsonb(room_player) order by room_player.seat_index)
        from public.room_players as room_player
        where room_player.room_id = p_room_id
      ),
      '[]'::jsonb
    ),
    'roomState', (
      select to_jsonb(selected_state)
      from selected_state
    ),
    'handWords', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'player_id', hand_word.player_id,
            'word', hand_word.word,
            'catalog_word_id', hand_word.catalog_word_id,
            'deal_version', hand_word.deal_version
          )
          order by hand_word.player_id
        )
        from public.hand_words as hand_word
        cross join selected_hand
        where hand_word.room_id = p_room_id
          and hand_word.hand_number = selected_hand.hand_number
      ),
      '[]'::jsonb
    ),
    'reservation', (
      select jsonb_build_object(
        'deal_version', neutral_word.deal_version,
        'cycle_number', neutral_word.cycle_number,
        'catalog_word_id', neutral_word.catalog_word_id,
        'word', neutral_word.word
      )
      from private.hand_neutral_words as neutral_word
      cross join selected_hand
      where neutral_word.room_id = p_room_id
        and neutral_word.hand_number = selected_hand.hand_number
    ),
    'receipt', (
      select jsonb_build_object(
        'action_type', prior_action.action_type,
        'response_json', prior_action.response_json,
        'version_after', prior_action.version_after
      )
      from public.room_actions as prior_action
      where p_command_id is not null
        and prior_action.room_id = p_room_id
        and prior_action.actor_user_id = p_actor_user_id
        and prior_action.command_id = p_command_id
        and prior_action.accepted
        and prior_action.response_json is not null
      order by prior_action.id desc
      limit 1
    )
  );
$$;

revoke all on function public.get_game_action_context(uuid, uuid, uuid) from public;
revoke all on function public.get_game_action_context(uuid, uuid, uuid) from anon;
revoke all on function public.get_game_action_context(uuid, uuid, uuid) from authenticated;
grant execute on function public.get_game_action_context(uuid, uuid, uuid) to service_role;

grant select, insert, update on public.room_actions to service_role;
grant usage, select on sequence public.room_actions_id_seq to service_role;

comment on function public.get_game_action_context(uuid, uuid, uuid) is
  'Service-role-only action context containing room state, private hand data, neutral reservation, and a successful idempotency receipt.';

comment on column public.room_actions.command_id is
  'Client-generated idempotency key for an authoritative game command.';

comment on column public.room_actions.response_json is
  'Sanitized successful response cached for idempotent command replay.';
