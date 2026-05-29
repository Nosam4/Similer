import { useEffect, useMemo, useState } from 'react'
import { isSupabaseConfigured } from '../lib/supabaseClient'
import {
  createRoom,
  ensureAnonymousSession,
  fetchRoom,
  fetchRoomPlayers,
  fetchRoomState,
  joinRoomByCode,
  leaveRoom,
  normalizeRoomCode,
  setReady,
  subscribeToRoom,
} from '../multiplayer/roomApi'

const DEFAULT_DISPLAY_NAME = 'Player'

function OnlineRoomPanel({
  onSessionChange = null,
  onStartOnlineGame = null,
  onlineGameBusy = false,
}) {
  const [userId, setUserId] = useState('')
  const [displayName, setDisplayName] = useState(DEFAULT_DISPLAY_NAME)
  const [roomCodeInput, setRoomCodeInput] = useState('')
  const [room, setRoom] = useState(null)
  const [roomState, setRoomState] = useState(null)
  const [players, setPlayers] = useState([])
  const [busy, setBusy] = useState(false)
  const [errorText, setErrorText] = useState('')
  const [booting, setBooting] = useState(isSupabaseConfigured)

  useEffect(() => {
    if (!isSupabaseConfigured) {
      return undefined
    }

    let isMounted = true

    async function boot() {
      try {
        const user = await ensureAnonymousSession()
        if (!isMounted) {
          return
        }

        setUserId(user.id)
      } catch (error) {
        if (!isMounted) {
          return
        }

        setErrorText(error instanceof Error ? error.message : 'Failed to initialize Supabase.')
      } finally {
        if (isMounted) {
          setBooting(false)
        }
      }
    }

    boot()

    return () => {
      isMounted = false
    }
  }, [])

  useEffect(() => {
    if (!room?.id) {
      return undefined
    }

    let isMounted = true

    async function refreshRoomState() {
      try {
        const [nextRoom, nextPlayers, nextRoomState] = await Promise.all([
          fetchRoom(room.id),
          fetchRoomPlayers(room.id),
          fetchRoomState(room.id),
        ])

        if (!isMounted) {
          return
        }

        setRoom(nextRoom)
        setPlayers(nextPlayers)
        setRoomState(nextRoomState)
        setErrorText('')
      } catch (error) {
        if (!isMounted) {
          return
        }

        setErrorText(error instanceof Error ? error.message : 'Failed to refresh room data.')
      }
    }

    const unsubscribe = subscribeToRoom({
      roomId: room.id,
      onAnyChange: refreshRoomState,
    })

    refreshRoomState()

    return () => {
      isMounted = false
      unsubscribe()
    }
  }, [room?.id])

  const myPlayer = useMemo(() => {
    if (!userId) {
      return null
    }

    return players.find((player) => player.user_id === userId) ?? null
  }, [players, userId])

  useEffect(() => {
    if (!onSessionChange) {
      return
    }

    onSessionChange({
      userId,
      room,
      roomState,
      players,
      myPlayer,
    })
  }, [myPlayer, onSessionChange, players, room, roomState, userId])

  const seatRows = useMemo(() => {
    const maxPlayers = room?.max_players ?? 4
    const seats = []

    for (let seatIndex = 0; seatIndex < maxPlayers; seatIndex += 1) {
      const occupant = players.find((player) => player.seat_index === seatIndex) ?? null
      seats.push({ seatIndex, occupant })
    }

    return seats
  }, [players, room?.max_players])

  async function handleCreateRoom() {
    const trimmedName = displayName.trim() || DEFAULT_DISPLAY_NAME
    setBusy(true)
    setErrorText('')

    try {
      const created = await createRoom({ displayName: trimmedName })
      const [nextRoom, nextPlayers] = await Promise.all([
        fetchRoom(created.room_id),
        fetchRoomPlayers(created.room_id),
      ])
      const nextRoomState = await fetchRoomState(created.room_id)
      setRoom(nextRoom)
      setPlayers(nextPlayers)
      setRoomState(nextRoomState)
      setDisplayName(trimmedName)
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Room creation failed.')
    } finally {
      setBusy(false)
    }
  }

  async function handleJoinRoom() {
    const trimmedName = displayName.trim() || DEFAULT_DISPLAY_NAME
    setBusy(true)
    setErrorText('')

    try {
      const joined = await joinRoomByCode({
        code: roomCodeInput,
        displayName: trimmedName,
      })
      const [nextRoom, nextPlayers] = await Promise.all([
        fetchRoom(joined.room_id),
        fetchRoomPlayers(joined.room_id),
      ])
      const nextRoomState = await fetchRoomState(joined.room_id)
      setRoom(nextRoom)
      setPlayers(nextPlayers)
      setRoomState(nextRoomState)
      setDisplayName(trimmedName)
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Join failed.')
    } finally {
      setBusy(false)
    }
  }

  async function handleToggleReady() {
    if (!room?.id || !userId || !myPlayer) {
      return
    }

    setBusy(true)
    setErrorText('')

    try {
      await setReady({
        roomId: room.id,
        userId,
        isReady: !myPlayer.is_ready,
      })
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Unable to update ready state.')
    } finally {
      setBusy(false)
    }
  }

  async function handleLeaveRoom() {
    if (!room?.id) {
      return
    }

    setBusy(true)
    setErrorText('')

    try {
      await leaveRoom({ roomId: room.id })
      setRoom(null)
      setRoomState(null)
      setPlayers([])
      setRoomCodeInput('')
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Leave room failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="online-room-panel">
      <h3>Online Multiplayer (Supabase Rooms)</h3>

      <p className="online-room-copy">
        Phase 1 foundation: create/join a 4-player room, sync seats and ready state in real
        time. Gameplay sync is next.
      </p>

      {!isSupabaseConfigured ? (
        <p className="online-room-copy">
          Supabase is not configured yet. Add `VITE_SUPABASE_URL` and
          `VITE_SUPABASE_PUBLISHABLE_KEY` in your `.env.local`.
        </p>
      ) : null}

      <div className="online-room-controls">
        <label>
          Display Name
          <input
            type="text"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            maxLength={32}
            placeholder="Player name"
            disabled={booting || busy}
          />
        </label>
      </div>

      {!isSupabaseConfigured ? null : !room ? (
        <div className="online-room-actions">
          <button type="button" disabled={booting || busy || !userId} onClick={handleCreateRoom}>
            Create Room
          </button>

          <label>
            Join Code
            <input
              type="text"
              value={roomCodeInput}
              onChange={(event) => setRoomCodeInput(normalizeRoomCode(event.target.value))}
              maxLength={6}
              placeholder="ABC123"
              disabled={booting || busy || !userId}
            />
          </label>

          <button
            type="button"
            disabled={booting || busy || !userId || roomCodeInput.length !== 6}
            onClick={handleJoinRoom}
          >
            Join Room
          </button>
        </div>
      ) : (
        <div className="online-room-live">
          <p>
            Room Code: <b>{room.code}</b> | Status: <b>{room.status}</b> | Players:{' '}
            <b>
              {players.length}/{room.max_players}
            </b>
          </p>
          <div className="online-room-actions">
            <button type="button" disabled={busy || !myPlayer} onClick={handleToggleReady}>
              {myPlayer?.is_ready ? 'Mark Not Ready' : 'Mark Ready'}
            </button>
            {room.host_user_id === userId ? (
              <button
                type="button"
                disabled={
                  busy ||
                  onlineGameBusy ||
                  !onStartOnlineGame ||
                  room.status === 'playing' ||
                  players.length < 3
                }
                onClick={onStartOnlineGame}
              >
                Start Online Game
              </button>
            ) : null}
            <button type="button" disabled={busy} onClick={handleLeaveRoom}>
              Leave Room
            </button>
          </div>
          {room.host_user_id === userId && players.length < 3 ? (
            <p className="online-room-copy">
              Need at least 3 players to start this game mode.
            </p>
          ) : null}
        </div>
      )}

      {!isSupabaseConfigured ? null : (
        <div className="online-room-seats">
          {seatRows.map((seat) => (
            <div
              key={seat.seatIndex}
              className={`seat-card${seat.occupant ? ' occupied' : ''}${seat.occupant?.is_ready ? ' ready' : ''}`}
            >
              <strong>Seat {seat.seatIndex + 1}</strong>
              {seat.occupant ? (
                <span>
                  {seat.occupant.display_name}
                  {seat.occupant.user_id === userId ? ' (You)' : ''}
                  {seat.occupant.is_ready ? ' | Ready' : ' | Not Ready'}
                </span>
              ) : (
                <span>Open seat</span>
              )}
            </div>
          ))}
        </div>
      )}

      {errorText ? <p className="error-text">{errorText}</p> : null}
    </section>
  )
}

export default OnlineRoomPanel
