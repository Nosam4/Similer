-- Private showdown vote rows are intentionally hidden by RLS, so other clients
-- may not receive realtime events when a player submits a vote. Bump the public
-- room state version after each valid vote so every client refetches vote status.

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

  update public.room_states
  set
    version = version + 1,
    updated_by = auth.uid()
  where room_id = p_room_id;
end;
$$;

grant execute on function public.submit_showdown_vote(uuid, integer, integer, text, integer) to authenticated;
