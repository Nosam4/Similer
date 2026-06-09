create table if not exists public.hand_words (
  room_id uuid not null references public.rooms (id) on delete cascade,
  hand_number integer not null check (hand_number > 0),
  player_id integer not null check (player_id >= 0),
  user_id uuid not null references auth.users (id) on delete cascade,
  word text not null check (length(trim(word)) > 0),
  is_revealed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (room_id, hand_number, player_id)
);

create table if not exists public.showdown_votes (
  room_id uuid not null references public.rooms (id) on delete cascade,
  hand_number integer not null check (hand_number > 0),
  voter_player_id integer not null check (voter_player_id >= 0),
  voter_user_id uuid not null references auth.users (id) on delete cascade,
  vote_type text not null check (vote_type in ('player', 'judge')),
  target_player_id integer not null check (target_player_id >= 0),
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (room_id, hand_number, voter_player_id, vote_type)
);

create index if not exists hand_words_room_hand_idx
on public.hand_words (room_id, hand_number);

create index if not exists showdown_votes_room_hand_idx
on public.showdown_votes (room_id, hand_number);

drop trigger if exists hand_words_set_updated_at on public.hand_words;
create trigger hand_words_set_updated_at
before update on public.hand_words
for each row execute function public.set_updated_at();

drop trigger if exists showdown_votes_set_updated_at on public.showdown_votes;
create trigger showdown_votes_set_updated_at
before update on public.showdown_votes
for each row execute function public.set_updated_at();

create or replace function public.is_room_host(target_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.rooms room_row
    where room_row.id = target_room_id
      and room_row.host_user_id = auth.uid()
  );
$$;

create or replace function public.replace_hand_words(
  p_room_id uuid,
  p_hand_number integer,
  p_words jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if not public.is_room_member(p_room_id) then
    raise exception 'Room membership required.';
  end if;

  delete from public.hand_words
  where room_id = p_room_id
    and hand_number = p_hand_number;

  delete from public.showdown_votes
  where room_id = p_room_id
    and hand_number = p_hand_number;

  insert into public.hand_words (
    room_id,
    hand_number,
    player_id,
    user_id,
    word,
    is_revealed
  )
  select
    p_room_id,
    p_hand_number,
    (word_row.value ->> 'playerId')::integer,
    room_player.user_id,
    trim(word_row.value ->> 'word'),
    false
  from jsonb_array_elements(coalesce(p_words, '[]'::jsonb)) as word_row(value)
  join public.room_players as room_player
    on room_player.room_id = p_room_id
   and room_player.seat_index = (word_row.value ->> 'playerId')::integer
  where trim(coalesce(word_row.value ->> 'word', '')) <> ''
  on conflict (room_id, hand_number, player_id) do update
  set
    user_id = excluded.user_id,
    word = excluded.word,
    is_revealed = false,
    updated_at = now();
end;
$$;

create or replace function public.reveal_judge_word(
  p_room_id uuid,
  p_hand_number integer,
  p_player_id integer
)
returns table (player_id integer, word text)
language plpgsql
security definer
set search_path = public
as $$
declare
  public_state jsonb;
  public_phase text;
  public_judge_id integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if not public.is_room_member(p_room_id) then
    raise exception 'Room membership required.';
  end if;

  select state_json
  into public_state
  from public.room_states
  where room_id = p_room_id;

  public_phase := public_state ->> 'phase';
  public_judge_id := nullif(public_state ->> 'judgePlayerId', '')::integer;

  if (public_state ->> 'handNumber')::integer <> p_hand_number then
    raise exception 'Judge word reveal does not match the active hand.';
  end if;

  if public_phase not in ('postflop', 'debate', 'showdownVoting', 'handComplete') then
    raise exception 'Judge word cannot be revealed during this phase.';
  end if;

  if public_judge_id is distinct from p_player_id then
    raise exception 'Requested player is not the active judge.';
  end if;

  update public.hand_words as hand_word
  set is_revealed = true
  where hand_word.room_id = p_room_id
    and hand_word.hand_number = p_hand_number
    and hand_word.player_id = p_player_id;

  return query
  select hand_word.player_id, hand_word.word
  from public.hand_words as hand_word
  where hand_word.room_id = p_room_id
    and hand_word.hand_number = p_hand_number
    and hand_word.player_id = p_player_id;
end;
$$;

create or replace function public.reveal_hand_words(
  p_room_id uuid,
  p_hand_number integer,
  p_player_ids integer[] default null
)
returns table (player_id integer, word text)
language plpgsql
security definer
set search_path = public
as $$
declare
  public_state jsonb;
  public_phase text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if not public.is_room_member(p_room_id) then
    raise exception 'Room membership required.';
  end if;

  select state_json
  into public_state
  from public.room_states
  where room_id = p_room_id;

  public_phase := public_state ->> 'phase';

  if (public_state ->> 'handNumber')::integer <> p_hand_number then
    raise exception 'Word reveal does not match the active hand.';
  end if;

  if public_phase not in ('debate', 'showdownVoting', 'handComplete') then
    raise exception 'Player words cannot be revealed during this phase.';
  end if;

  update public.hand_words as hand_word
  set is_revealed = true
  where hand_word.room_id = p_room_id
    and hand_word.hand_number = p_hand_number
    and (
      p_player_ids is null
      or hand_word.player_id = any(p_player_ids)
    );

  return query
  select hand_word.player_id, hand_word.word
  from public.hand_words as hand_word
  where hand_word.room_id = p_room_id
    and hand_word.hand_number = p_hand_number
    and (
      p_player_ids is null
      or hand_word.player_id = any(p_player_ids)
    )
  order by hand_word.player_id;
end;
$$;

create or replace function public.submit_showdown_vote(
  p_room_id uuid,
  p_hand_number integer,
  p_voter_player_id integer,
  p_vote_type text,
  p_target_player_id integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  public_state jsonb;
  public_phase text;
  public_judge_id integer;
  voter_row public.room_players%rowtype;
  target_is_contender boolean;
  voter_is_contender boolean;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if not public.is_room_member(p_room_id) then
    raise exception 'Room membership required.';
  end if;

  if p_vote_type not in ('player', 'judge') then
    raise exception 'Invalid vote type.';
  end if;

  select *
  into voter_row
  from public.room_players
  where room_id = p_room_id
    and user_id = auth.uid()
    and seat_index = p_voter_player_id;

  if voter_row.user_id is null then
    raise exception 'Only the seated player can submit this vote.';
  end if;

  select state_json
  into public_state
  from public.room_states
  where room_id = p_room_id;

  public_phase := public_state ->> 'phase';
  public_judge_id := nullif(public_state ->> 'judgePlayerId', '')::integer;

  if (public_state ->> 'handNumber')::integer <> p_hand_number then
    raise exception 'Vote does not match the active hand.';
  end if;

  if public_phase <> 'showdownVoting' then
    raise exception 'Votes can only be submitted during showdown voting.';
  end if;

  select exists (
    select 1
    from jsonb_array_elements(public_state -> 'players') as player_row(value)
    where (player_row.value ->> 'id')::integer = p_target_player_id
      and coalesce((player_row.value ->> 'inHand')::boolean, false)
      and not coalesce((player_row.value ->> 'folded')::boolean, false)
      and not coalesce((player_row.value ->> 'isJudge')::boolean, false)
  )
  into target_is_contender;

  if not target_is_contender then
    raise exception 'Vote target must be an active contender.';
  end if;

  if p_vote_type = 'player' then
    if p_target_player_id = p_voter_player_id then
      raise exception 'Players cannot vote for their own word.';
    end if;

    select exists (
      select 1
      from jsonb_array_elements(public_state -> 'players') as player_row(value)
      where (player_row.value ->> 'id')::integer = p_voter_player_id
        and coalesce((player_row.value ->> 'inHand')::boolean, false)
        and not coalesce((player_row.value ->> 'folded')::boolean, false)
        and not coalesce((player_row.value ->> 'isJudge')::boolean, false)
    )
    into voter_is_contender;

    if not voter_is_contender then
      raise exception 'Only active contenders submit player votes.';
    end if;
  else
    if public_judge_id is distinct from p_voter_player_id then
      raise exception 'Only the active judge can submit the judge vote.';
    end if;
  end if;

  insert into public.showdown_votes (
    room_id,
    hand_number,
    voter_player_id,
    voter_user_id,
    vote_type,
    target_player_id,
    submitted_at
  )
  values (
    p_room_id,
    p_hand_number,
    p_voter_player_id,
    auth.uid(),
    p_vote_type,
    p_target_player_id,
    now()
  )
  on conflict (room_id, hand_number, voter_player_id, vote_type) do update
  set
    target_player_id = excluded.target_player_id,
    submitted_at = now(),
    updated_at = now();
end;
$$;

create or replace function public.get_showdown_vote_statuses(
  p_room_id uuid,
  p_hand_number integer
)
returns table (vote_type text, voter_player_id integer, submitted boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  public_state jsonb;
  public_judge_id integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if not public.is_room_member(p_room_id) then
    raise exception 'Room membership required.';
  end if;

  select state_json
  into public_state
  from public.room_states
  where room_id = p_room_id;

  if public_state is null or (public_state ->> 'handNumber')::integer <> p_hand_number then
    return;
  end if;

  public_judge_id := nullif(public_state ->> 'judgePlayerId', '')::integer;

  return query
  select
    'player'::text,
    (player_row.value ->> 'id')::integer,
    exists (
      select 1
      from public.showdown_votes vote_row
      where vote_row.room_id = p_room_id
        and vote_row.hand_number = p_hand_number
        and vote_row.vote_type = 'player'
        and vote_row.voter_player_id = (player_row.value ->> 'id')::integer
    )
  from jsonb_array_elements(public_state -> 'players') as player_row(value)
  where coalesce((player_row.value ->> 'inHand')::boolean, false)
    and not coalesce((player_row.value ->> 'folded')::boolean, false)
    and not coalesce((player_row.value ->> 'isJudge')::boolean, false)

  union all

  select
    'judge'::text,
    public_judge_id,
    exists (
      select 1
      from public.showdown_votes vote_row
      where vote_row.room_id = p_room_id
        and vote_row.hand_number = p_hand_number
        and vote_row.vote_type = 'judge'
        and vote_row.voter_player_id = public_judge_id
    )
  where public_judge_id is not null;
end;
$$;

create or replace function public.get_showdown_votes_for_resolution(
  p_room_id uuid,
  p_hand_number integer
)
returns table (vote_type text, voter_player_id integer, target_player_id integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  public_state jsonb;
  public_phase text;
  public_judge_id integer;
  required_player_ids integer[];
  submitted_player_count integer;
  required_player_count integer;
  judge_vote_submitted boolean;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if not public.is_room_member(p_room_id) then
    raise exception 'Room membership required.';
  end if;

  select state_json
  into public_state
  from public.room_states
  where room_id = p_room_id;

  public_phase := public_state ->> 'phase';

  if public_state is null or (public_state ->> 'handNumber')::integer <> p_hand_number then
    raise exception 'Vote resolution does not match the active hand.';
  end if;

  if public_phase <> 'showdownVoting' then
    raise exception 'Votes can only be read for resolution during showdown voting.';
  end if;

  select coalesce(array_agg((player_row.value ->> 'id')::integer), array[]::integer[])
  into required_player_ids
  from jsonb_array_elements(public_state -> 'players') as player_row(value)
  where coalesce((player_row.value ->> 'inHand')::boolean, false)
    and not coalesce((player_row.value ->> 'folded')::boolean, false)
    and not coalesce((player_row.value ->> 'isJudge')::boolean, false);

  required_player_count := cardinality(required_player_ids);
  public_judge_id := nullif(public_state ->> 'judgePlayerId', '')::integer;

  select count(*)
  into submitted_player_count
  from public.showdown_votes vote_row
  where vote_row.room_id = p_room_id
    and vote_row.hand_number = p_hand_number
    and vote_row.vote_type = 'player'
    and vote_row.voter_player_id = any(required_player_ids);

  if submitted_player_count < required_player_count then
    raise exception 'Waiting for all player votes.';
  end if;

  if public_judge_id is not null then
    select exists (
      select 1
      from public.showdown_votes vote_row
      where vote_row.room_id = p_room_id
        and vote_row.hand_number = p_hand_number
        and vote_row.vote_type = 'judge'
        and vote_row.voter_player_id = public_judge_id
    )
    into judge_vote_submitted;

    if not judge_vote_submitted then
      raise exception 'Waiting for judge vote.';
    end if;
  end if;

  return query
  select
    vote_row.vote_type,
    vote_row.voter_player_id,
    vote_row.target_player_id
  from public.showdown_votes vote_row
  where vote_row.room_id = p_room_id
    and vote_row.hand_number = p_hand_number
    and (
      (
        vote_row.vote_type = 'player'
        and vote_row.voter_player_id = any(required_player_ids)
      )
      or (
        vote_row.vote_type = 'judge'
        and public_judge_id is not null
        and vote_row.voter_player_id = public_judge_id
      )
    )
  order by vote_row.vote_type, vote_row.voter_player_id;
end;
$$;

grant select on public.hand_words to authenticated;
grant select on public.showdown_votes to authenticated;

grant execute on function public.is_room_host(uuid) to authenticated;
grant execute on function public.replace_hand_words(uuid, integer, jsonb) to authenticated;
grant execute on function public.reveal_judge_word(uuid, integer, integer) to authenticated;
grant execute on function public.reveal_hand_words(uuid, integer, integer[]) to authenticated;
grant execute on function public.submit_showdown_vote(uuid, integer, integer, text, integer) to authenticated;
grant execute on function public.get_showdown_vote_statuses(uuid, integer) to authenticated;
grant execute on function public.get_showdown_votes_for_resolution(uuid, integer) to authenticated;

alter table public.hand_words enable row level security;
alter table public.showdown_votes enable row level security;

drop policy if exists "room members read own or revealed hand words" on public.hand_words;
create policy "room members read own or revealed hand words"
on public.hand_words
for select
to authenticated
using (
  public.is_room_member(room_id)
  and (
    user_id = (select auth.uid())
    or is_revealed
  )
);

drop policy if exists "players read own showdown votes" on public.showdown_votes;
create policy "players read own showdown votes"
on public.showdown_votes
for select
to authenticated
using (
  public.is_room_member(room_id)
  and voter_user_id = (select auth.uid())
);
