-- Table Vote Rule: everyone except the Judge can submit the Player Vote,
-- while only active contenders can receive Player Votes.

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
  voter_can_player_vote boolean;
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

  if public_state is null then
    raise exception 'Room state not found.';
  end if;

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
    select exists (
      select 1
      from jsonb_array_elements(public_state -> 'players') as player_row(value)
      where (player_row.value ->> 'id')::integer = p_voter_player_id
        and not coalesce((player_row.value ->> 'isJudge')::boolean, false)
    )
    into voter_can_player_vote;

    if not voter_can_player_vote then
      raise exception 'The Judge does not submit a Player Vote.';
    end if;

    if p_target_player_id = p_voter_player_id then
      raise exception 'Players cannot vote for their own word.';
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

  update public.room_states
  set
    version = version + 1,
    updated_by = auth.uid()
  where room_id = p_room_id;
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
  where not coalesce((player_row.value ->> 'isJudge')::boolean, false)

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

  if public_state is null or (public_state ->> 'handNumber')::integer <> p_hand_number then
    raise exception 'Vote resolution does not match the active hand.';
  end if;

  public_phase := public_state ->> 'phase';

  if public_phase <> 'showdownVoting' then
    raise exception 'Votes can only be read for resolution during showdown voting.';
  end if;

  select coalesce(array_agg((player_row.value ->> 'id')::integer), array[]::integer[])
  into required_player_ids
  from jsonb_array_elements(public_state -> 'players') as player_row(value)
  where not coalesce((player_row.value ->> 'isJudge')::boolean, false);

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

grant execute on function public.submit_showdown_vote(uuid, integer, integer, text, integer) to authenticated;
grant execute on function public.get_showdown_vote_statuses(uuid, integer) to authenticated;
revoke execute on function public.get_showdown_votes_for_resolution(uuid, integer) from authenticated;
revoke execute on function public.get_showdown_votes_for_resolution(uuid, integer) from public;
