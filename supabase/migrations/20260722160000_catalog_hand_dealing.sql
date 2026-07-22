-- Additive, service-role-only catalog dealing. A catalog deal selects all player
-- words plus one neutral Judge word, records their shuffle-cycle usage, replaces
-- the private hand rows, and advances the public room state in one transaction.

alter table public.hand_words
add column if not exists catalog_word_id bigint;

alter table public.hand_words
add column if not exists deal_version integer;

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conname = 'hand_words_catalog_word_id_fkey'
      and conrelid = 'public.hand_words'::regclass
  ) then
    alter table public.hand_words
    add constraint hand_words_catalog_word_id_fkey
    foreign key (catalog_word_id)
    references private.word_catalog (id);
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conname = 'hand_words_deal_version_check'
      and conrelid = 'public.hand_words'::regclass
  ) then
    alter table public.hand_words
    add constraint hand_words_deal_version_check
    check (deal_version is null or deal_version > 0);
  end if;
end;
$$;

create index if not exists hand_words_catalog_word_idx
on public.hand_words (catalog_word_id)
where catalog_word_id is not null;

create table if not exists private.room_word_cycles (
  room_id uuid primary key references public.rooms (id) on delete cascade,
  current_cycle integer not null default 1 check (current_cycle > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists private.room_word_cycle_usage (
  room_id uuid not null references public.rooms (id) on delete cascade,
  cycle_number integer not null check (cycle_number > 0),
  catalog_word_id bigint not null references private.word_catalog (id),
  hand_number integer not null check (hand_number > 0),
  deal_version integer not null check (deal_version > 0),
  assignment_kind text not null check (assignment_kind in ('player', 'neutral')),
  player_id integer,
  used_at timestamptz not null default now(),
  primary key (room_id, cycle_number, catalog_word_id),
  constraint room_word_cycle_usage_player_check
    check (
      (assignment_kind = 'player' and player_id is not null and player_id >= 0)
      or (assignment_kind = 'neutral' and player_id is null)
    )
);

create index if not exists room_word_cycle_usage_deal_idx
on private.room_word_cycle_usage (room_id, deal_version);

create table if not exists private.hand_neutral_words (
  room_id uuid not null references public.rooms (id) on delete cascade,
  hand_number integer not null check (hand_number > 0),
  deal_version integer not null check (deal_version > 0),
  cycle_number integer not null check (cycle_number > 0),
  catalog_word_id bigint not null references private.word_catalog (id),
  word text not null check (word = lower(trim(word)) and length(word) > 0),
  created_at timestamptz not null default now(),
  primary key (room_id, hand_number)
);

drop trigger if exists room_word_cycles_set_updated_at on private.room_word_cycles;
create trigger room_word_cycles_set_updated_at
before update on private.room_word_cycles
for each row execute function public.set_updated_at();

alter table private.room_word_cycles enable row level security;
alter table private.room_word_cycle_usage enable row level security;
alter table private.hand_neutral_words enable row level security;

grant select, insert, update, delete on private.room_word_cycles to service_role;
grant select, insert, update, delete on private.room_word_cycle_usage to service_role;
grant select, insert, update, delete on private.hand_neutral_words to service_role;

create or replace function public.deal_catalog_hand(
  p_room_id uuid,
  p_hand_number integer,
  p_expected_version integer,
  p_player_ids integer[],
  p_state_json jsonb,
  p_updated_by uuid,
  p_next_status text default null,
  p_embedding_model text default 'word2vec-google-news-300'
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
<<catalog_deal>>
declare
  target_room public.rooms%rowtype;
  current_state public.room_states%rowtype;
  saved_state public.room_states%rowtype;
  normalized_player_ids integer[];
  state_player_ids integer[];
  selected_catalog_ids bigint[];
  selected_words text[];
  target_version integer;
  player_count integer;
  required_word_count integer;
  mapped_player_count integer;
  existing_player_count integer;
  existing_total_count integer;
  available_word_count integer;
  cycle_number integer;
  player_index integer;
  mapped_user_id uuid;
begin
  if p_room_id is null or p_hand_number is null or p_hand_number < 1 then
    raise exception 'A valid room and hand number are required.';
  end if;

  if p_expected_version is null or p_expected_version < 1 then
    raise exception 'A valid expected room-state version is required.';
  end if;

  if p_updated_by is null then
    raise exception 'The updating user is required.';
  end if;

  if jsonb_typeof(coalesce(p_state_json, '{}'::jsonb)) <> 'object' then
    raise exception 'The next room state must be a JSON object.';
  end if;

  if trim(coalesce(p_embedding_model, '')) = '' then
    raise exception 'The embedding model is required.';
  end if;

  if p_next_status is not null and p_next_status not in ('waiting', 'playing', 'finished') then
    raise exception 'Invalid next room status.';
  end if;

  select array_agg(distinct requested_player_id order by requested_player_id)
  into normalized_player_ids
  from unnest(coalesce(p_player_ids, array[]::integer[])) as requested(requested_player_id);

  player_count := coalesce(array_length(normalized_player_ids, 1), 0);
  if player_count < 2 or player_count > 8 then
    raise exception 'Catalog dealing requires between 2 and 8 unique players.';
  end if;

  if player_count <> coalesce(array_length(p_player_ids, 1), 0) then
    raise exception 'Catalog dealing received duplicate player ids.';
  end if;

  if exists (
    select 1
    from unnest(normalized_player_ids) as requested(requested_player_id)
    where requested_player_id < 0
  ) then
    raise exception 'Player ids must be non-negative.';
  end if;

  if nullif(p_state_json ->> 'handNumber', '')::integer is distinct from p_hand_number then
    raise exception 'The next room state does not match the requested hand.';
  end if;

  select array_agg((player_row.value ->> 'id')::integer order by (player_row.value ->> 'id')::integer)
  into state_player_ids
  from jsonb_array_elements(coalesce(p_state_json -> 'players', '[]'::jsonb)) as player_row(value)
  where coalesce((player_row.value ->> 'inHand')::boolean, false);

  if state_player_ids is distinct from normalized_player_ids then
    raise exception 'Catalog player ids do not match the active players in the next room state.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_state_json -> 'players', '[]'::jsonb)) as player_row(value)
    where nullif(trim(coalesce(player_row.value ->> 'holeWord', '')), '') is not null
  ) then
    raise exception 'Private player words must not be stored in the public room state.';
  end if;

  select *
  into target_room
  from public.rooms
  where id = p_room_id
  for update;

  if target_room.id is null then
    raise exception 'Room not found.';
  end if;

  if target_room.host_user_id is distinct from p_updated_by then
    raise exception 'Only the room host can persist a catalog deal.';
  end if;

  select count(*)
  into mapped_player_count
  from public.room_players as room_player
  where room_player.room_id = p_room_id
    and room_player.seat_index = any(normalized_player_ids);

  if mapped_player_count <> player_count then
    raise exception 'Every catalog player id must map to a current room seat.';
  end if;

  select *
  into current_state
  from public.room_states
  where room_id = p_room_id
  for update;

  if current_state.room_id is null then
    raise exception 'Room state not found.';
  end if;

  target_version := p_expected_version + 1;

  if current_state.version = target_version then
    select
      count(*) filter (
        where hand_word.deal_version = target_version
          and hand_word.catalog_word_id is not null
          and hand_word.player_id = any(normalized_player_ids)
      ),
      count(*)
    into existing_player_count, existing_total_count
    from public.hand_words as hand_word
    where hand_word.room_id = p_room_id
      and hand_word.hand_number = p_hand_number;

    if current_state.state_json = p_state_json
      and existing_player_count = player_count
      and existing_total_count = player_count
      and exists (
        select 1
        from private.hand_neutral_words as neutral_word
        where neutral_word.room_id = p_room_id
          and neutral_word.hand_number = p_hand_number
          and neutral_word.deal_version = target_version
      ) then
      return jsonb_build_object(
        'roomState', to_jsonb(current_state),
        'room', to_jsonb(target_room),
        'idempotent', true
      );
    end if;
  end if;

  if current_state.version <> p_expected_version then
    raise exception 'Room state changed on another device. Please try again.';
  end if;

  delete from public.hand_words
  where room_id = p_room_id
    and hand_number = p_hand_number;

  delete from public.showdown_votes
  where room_id = p_room_id
    and hand_number = p_hand_number;

  delete from private.hand_neutral_words
  where room_id = p_room_id
    and hand_number = p_hand_number;

  delete from private.room_word_cycle_usage
  where room_id = p_room_id
    and deal_version = target_version;

  insert into private.room_word_cycles (room_id, current_cycle)
  values (p_room_id, 1)
  on conflict (room_id) do nothing;

  select room_cycle.current_cycle
  into cycle_number
  from private.room_word_cycles as room_cycle
  where room_cycle.room_id = p_room_id
  for update;

  required_word_count := player_count + 1;

  select count(*)
  into available_word_count
  from private.word_catalog as catalog
  where catalog.active
    and catalog.embedding_model = trim(p_embedding_model)
    and not exists (
      select 1
      from private.room_word_cycle_usage as usage
      where usage.room_id = p_room_id
        and usage.cycle_number = catalog_deal.cycle_number
        and usage.catalog_word_id = catalog.id
    );

  if available_word_count < required_word_count then
    cycle_number := cycle_number + 1;

    update private.room_word_cycles
    set current_cycle = cycle_number
    where room_id = p_room_id;
  end if;

  select
    array_agg(candidate.id order by candidate.random_order),
    array_agg(candidate.word order by candidate.random_order)
  into selected_catalog_ids, selected_words
  from (
    select catalog.id, catalog.word, random() as random_order
    from private.word_catalog as catalog
    where catalog.active
      and catalog.embedding_model = trim(p_embedding_model)
      and not exists (
        select 1
        from private.room_word_cycle_usage as usage
        where usage.room_id = p_room_id
          and usage.cycle_number = catalog_deal.cycle_number
          and usage.catalog_word_id = catalog.id
      )
    order by random_order
    limit required_word_count
  ) as candidate;

  if coalesce(array_length(selected_catalog_ids, 1), 0) <> required_word_count then
    raise exception 'The active word catalog does not contain enough words for this hand.';
  end if;

  for player_index in 1..player_count loop
    select room_player.user_id
    into mapped_user_id
    from public.room_players as room_player
    where room_player.room_id = p_room_id
      and room_player.seat_index = normalized_player_ids[player_index];

    insert into public.hand_words (
      room_id,
      hand_number,
      player_id,
      user_id,
      word,
      is_revealed,
      catalog_word_id,
      deal_version
    )
    values (
      p_room_id,
      p_hand_number,
      normalized_player_ids[player_index],
      mapped_user_id,
      selected_words[player_index],
      false,
      selected_catalog_ids[player_index],
      target_version
    );

    insert into private.room_word_cycle_usage (
      room_id,
      cycle_number,
      catalog_word_id,
      hand_number,
      deal_version,
      assignment_kind,
      player_id
    )
    values (
      p_room_id,
      cycle_number,
      selected_catalog_ids[player_index],
      p_hand_number,
      target_version,
      'player',
      normalized_player_ids[player_index]
    );
  end loop;

  insert into private.hand_neutral_words (
    room_id,
    hand_number,
    deal_version,
    cycle_number,
    catalog_word_id,
    word
  )
  values (
    p_room_id,
    p_hand_number,
    target_version,
    cycle_number,
    selected_catalog_ids[required_word_count],
    selected_words[required_word_count]
  );

  insert into private.room_word_cycle_usage (
    room_id,
    cycle_number,
    catalog_word_id,
    hand_number,
    deal_version,
    assignment_kind,
    player_id
  )
  values (
    p_room_id,
    cycle_number,
    selected_catalog_ids[required_word_count],
    p_hand_number,
    target_version,
    'neutral',
    null
  );

  update public.room_states
  set
    version = target_version,
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
  end if;

  return jsonb_build_object(
    'roomState', to_jsonb(saved_state),
    'room', to_jsonb(target_room),
    'idempotent', false
  );
end;
$$;

create or replace function public.get_catalog_hand_reservation(
  p_room_id uuid,
  p_hand_number integer,
  p_deal_version integer
)
returns table (
  deal_version integer,
  cycle_number integer,
  catalog_word_id bigint,
  word text
)
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $$
  select
    neutral_word.deal_version,
    neutral_word.cycle_number,
    neutral_word.catalog_word_id,
    neutral_word.word
  from private.hand_neutral_words as neutral_word
  where neutral_word.room_id = p_room_id
    and neutral_word.hand_number = p_hand_number
    and neutral_word.deal_version = p_deal_version;
$$;

revoke all on function public.deal_catalog_hand(uuid, integer, integer, integer[], jsonb, uuid, text, text) from public;
revoke all on function public.deal_catalog_hand(uuid, integer, integer, integer[], jsonb, uuid, text, text) from anon;
revoke all on function public.deal_catalog_hand(uuid, integer, integer, integer[], jsonb, uuid, text, text) from authenticated;
grant execute on function public.deal_catalog_hand(uuid, integer, integer, integer[], jsonb, uuid, text, text) to service_role;

revoke all on function public.get_catalog_hand_reservation(uuid, integer, integer) from public;
revoke all on function public.get_catalog_hand_reservation(uuid, integer, integer) from anon;
revoke all on function public.get_catalog_hand_reservation(uuid, integer, integer) from authenticated;
grant execute on function public.get_catalog_hand_reservation(uuid, integer, integer) to service_role;

comment on function public.deal_catalog_hand(uuid, integer, integer, integer[], jsonb, uuid, text, text) is
  'Service-role-only transactional catalog dealing, neutral reservation, shuffle-cycle usage, and room-state CAS.';

comment on function public.get_catalog_hand_reservation(uuid, integer, integer) is
  'Service-role-only retrieval of the neutral Judge word reserved for a catalog-dealt hand.';
