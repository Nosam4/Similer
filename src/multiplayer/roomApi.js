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

export async function createRoom({ displayName }) {
  const client = getSupabaseClient()
  const response = await client.rpc('create_room', {
    p_display_name: displayName,
  })

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

export function subscribeToRoom({ roomId, onAnyChange }) {
  const client = getSupabaseClient()
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
    .subscribe()

  return () => {
    client.removeChannel(channel)
  }
}
