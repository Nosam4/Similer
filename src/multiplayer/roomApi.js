import { isSupabaseConfigured, supabase } from '../lib/supabaseClient'

function getSupabaseClient() {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error(
      'Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.',
    )
  }

  return supabase
}

export function normalizeRoomCode(input) {
  return String(input ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6)
}

export async function ensureAnonymousSession() {
  const client = getSupabaseClient()
  const existing = await client.auth.getSession()

  if (existing.error) {
    throw new Error(existing.error.message)
  }

  if (existing.data.session?.user) {
    return existing.data.session.user
  }

  const created = await client.auth.signInAnonymously()
  if (created.error) {
    throw new Error(created.error.message)
  }

  if (!created.data.user) {
    throw new Error('Unable to create anonymous user session.')
  }

  return created.data.user
}

function unwrapSingleRow(data) {
  if (Array.isArray(data)) {
    return data[0] ?? null
  }

  return data ?? null
}

export async function createRoom({ displayName, maxPlayers = 8 }) {
  const client = getSupabaseClient()
  const payload = {
    p_display_name: displayName,
    p_max_players: maxPlayers,
  }
  let response = await client.rpc('create_room', payload)

  if (response.error && /p_max_players|schema cache|function/i.test(response.error.message)) {
    response = await client.rpc('create_room', {
      p_display_name: displayName,
    })
  }

  if (response.error) {
    throw new Error(response.error.message)
  }

  const row = unwrapSingleRow(response.data)

  if (!row) {
    throw new Error('Room creation failed: no room was returned.')
  }

  return row
}

export async function joinRoomByCode({ code, displayName }) {
  const client = getSupabaseClient()
  const normalizedCode = normalizeRoomCode(code)

  if (normalizedCode.length !== 6) {
    throw new Error('Room code must be 6 characters.')
  }

  const response = await client.rpc('join_room', {
    p_room_code: normalizedCode,
    p_display_name: displayName,
  })

  if (response.error) {
    throw new Error(response.error.message)
  }

  const row = unwrapSingleRow(response.data)

  if (!row) {
    throw new Error('Join failed: room was not returned.')
  }

  return row
}

export async function leaveRoom({ roomId }) {
  const client = getSupabaseClient()
  const response = await client.rpc('leave_room', {
    p_room_id: roomId,
  })

  if (response.error) {
    throw new Error(response.error.message)
  }
}

export async function fetchRoom(roomId) {
  const client = getSupabaseClient()
  const response = await client
    .from('rooms')
    .select('id, code, host_user_id, status, max_players, created_at, updated_at')
    .eq('id', roomId)
    .maybeSingle()

  if (response.error) {
    throw new Error(response.error.message)
  }

  return response.data
}

export async function fetchRoomPlayers(roomId) {
  const client = getSupabaseClient()
  const response = await client
    .from('room_players')
    .select('room_id, user_id, display_name, seat_index, is_ready, joined_at')
    .eq('room_id', roomId)
    .order('seat_index', { ascending: true })

  if (response.error) {
    throw new Error(response.error.message)
  }

  return response.data ?? []
}

export async function fetchRoomState(roomId) {
  const client = getSupabaseClient()
  const response = await client
    .from('room_states')
    .select('room_id, version, state_json, updated_by, updated_at')
    .eq('room_id', roomId)
    .maybeSingle()

  if (response.error) {
    throw new Error(response.error.message)
  }

  return response.data
}

export async function invokeGameCommand({ roomId, command, payload = {} }) {
  const client = getSupabaseClient()
  const response = await client.functions.invoke('game-action', {
    body: {
      roomId,
      command,
      payload,
    },
  })

  if (response.error) {
    throw new Error(response.error.message)
  }

  if (response.data?.error) {
    throw new Error(response.data.error)
  }

  if (!response.data?.roomState) {
    throw new Error('Game command did not return an updated room state.')
  }

  return response.data
}

export async function setReady({ roomId, userId, isReady }) {
  const client = getSupabaseClient()
  const response = await client
    .from('room_players')
    .update({ is_ready: isReady })
    .eq('room_id', roomId)
    .eq('user_id', userId)

  if (response.error) {
    throw new Error(response.error.message)
  }
}

export async function setRoomStatus({ roomId, hostUserId, status }) {
  const client = getSupabaseClient()
  const response = await client
    .from('rooms')
    .update({ status })
    .eq('id', roomId)
    .eq('host_user_id', hostUserId)
    .select('id, code, host_user_id, status, max_players, created_at, updated_at')
    .maybeSingle()

  if (response.error) {
    throw new Error(response.error.message)
  }

  if (!response.data) {
    throw new Error('Only the room host can change room status.')
  }

  return response.data
}

export async function saveRoomState({
  roomId,
  nextState,
  updatedByUserId,
  expectedVersion = null,
}) {
  const client = getSupabaseClient()

  if (expectedVersion === null || expectedVersion === undefined) {
    const response = await client
      .from('room_states')
      .upsert(
        {
          room_id: roomId,
          version: 1,
          state_json: nextState,
          updated_by: updatedByUserId,
        },
        { onConflict: 'room_id' },
      )
      .select('room_id, version, state_json, updated_by, updated_at')
      .maybeSingle()

    if (response.error) {
      throw new Error(response.error.message)
    }

    if (!response.data) {
      throw new Error('Unable to save room state.')
    }

    return response.data
  }

  const response = await client
    .from('room_states')
    .update({
      version: Number(expectedVersion) + 1,
      state_json: nextState,
      updated_by: updatedByUserId,
    })
    .eq('room_id', roomId)
    .eq('version', expectedVersion)
    .select('room_id, version, state_json, updated_by, updated_at')
    .maybeSingle()

  if (response.error) {
    throw new Error(response.error.message)
  }

  if (!response.data) {
    throw new Error('Room state changed on another device. Please try again.')
  }

  return response.data
}

export async function replaceHandWords({ roomId, handNumber, words }) {
  const client = getSupabaseClient()
  const response = await client.rpc('replace_hand_words', {
    p_room_id: roomId,
    p_hand_number: handNumber,
    p_words: words,
  })

  if (response.error) {
    throw new Error(response.error.message)
  }
}

export async function fetchAccessibleHandWords({ roomId, handNumber }) {
  const client = getSupabaseClient()
  const response = await client
    .from('hand_words')
    .select('player_id, word, is_revealed')
    .eq('room_id', roomId)
    .eq('hand_number', handNumber)
    .order('player_id', { ascending: true })

  if (response.error) {
    throw new Error(response.error.message)
  }

  return response.data ?? []
}

export async function revealJudgeWord({ roomId, handNumber, playerId }) {
  const client = getSupabaseClient()
  const response = await client.rpc('reveal_judge_word', {
    p_room_id: roomId,
    p_hand_number: handNumber,
    p_player_id: playerId,
  })

  if (response.error) {
    throw new Error(response.error.message)
  }

  return response.data ?? []
}

export async function revealHandWords({ roomId, handNumber, playerIds = null }) {
  const client = getSupabaseClient()
  const response = await client.rpc('reveal_hand_words', {
    p_room_id: roomId,
    p_hand_number: handNumber,
    p_player_ids: playerIds,
  })

  if (response.error) {
    throw new Error(response.error.message)
  }

  return response.data ?? []
}

export async function submitShowdownVote({
  roomId,
  handNumber,
  voterPlayerId,
  voteType,
  targetPlayerId,
}) {
  const client = getSupabaseClient()
  const response = await client.rpc('submit_showdown_vote', {
    p_room_id: roomId,
    p_hand_number: handNumber,
    p_voter_player_id: voterPlayerId,
    p_vote_type: voteType,
    p_target_player_id: targetPlayerId,
  })

  if (response.error) {
    throw new Error(response.error.message)
  }
}

export async function fetchShowdownVoteStatuses({ roomId, handNumber }) {
  const client = getSupabaseClient()
  const response = await client.rpc('get_showdown_vote_statuses', {
    p_room_id: roomId,
    p_hand_number: handNumber,
  })

  if (response.error) {
    throw new Error(response.error.message)
  }

  return response.data ?? []
}

export async function fetchShowdownVotesForResolution({ roomId, handNumber }) {
  const client = getSupabaseClient()
  const response = await client.rpc('get_showdown_votes_for_resolution', {
    p_room_id: roomId,
    p_hand_number: handNumber,
  })

  if (response.error) {
    throw new Error(response.error.message)
  }

  return response.data ?? []
}

export function subscribeToRoom({ roomId, onAnyChange, onPrivateChange = null }) {
  const client = getSupabaseClient()
  const handlePrivateChange = onPrivateChange ?? onAnyChange
  const channel = client
    .channel(`room-${roomId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'rooms',
        filter: `id=eq.${roomId}`,
      },
      onAnyChange,
    )
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'room_players',
        filter: `room_id=eq.${roomId}`,
      },
      onAnyChange,
    )
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'room_states',
        filter: `room_id=eq.${roomId}`,
      },
      onAnyChange,
    )
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'hand_words',
        filter: `room_id=eq.${roomId}`,
      },
      handlePrivateChange,
    )
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'showdown_votes',
        filter: `room_id=eq.${roomId}`,
      },
      handlePrivateChange,
    )
    .subscribe()

  return () => {
    client.removeChannel(channel)
  }
}
