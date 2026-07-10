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
  normalizeDisplayName,
  normalizeRoomCode,
  sanitizeDisplayNameInput,
  setReady,
  subscribeToRoom,
} from '../multiplayer/roomApi'

const DEFAULT_DISPLAY_NAME = 'Player'
const MAX_ROOM_PLAYERS = 8

function OnlineRoomPanel({
  onSessionChange = null,
  onStartOnlineGame = null,
  onPrivateDataChange = null,
  onlineGameBusy = false,
  variant = 'panel',
  initialSession = null,
}) {
  const [userId, setUserId] = useState(() => initialSession?.userId ?? '')
  const [displayName, setDisplayName] = useState('')
  const [roomCodeInput, setRoomCodeInput] = useState('')
  const [room, setRoom] = useState(() => initialSession?.room ?? null)
  const [roomState, setRoomState] = useState(() => initialSession?.roomState ?? null)
  const [players, setPlayers] = useState(() => initialSession?.players ?? [])
  const [busy, setBusy] = useState(false)
  const [errorText, setErrorText] = useState('')
  const [booting, setBooting] = useState(isSupabaseConfigured && !initialSession?.userId)
  const [refreshTick, setRefreshTick] = useState(0)

  useEffect(() => {
    if (!isSupabaseConfigured || userId) {
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
  }, [userId])

  useEffect(() => {
    if (!room?.id) {
      return undefined
    }

    let isMounted = true

    async function refreshRoomState({ silent = false } = {}) {
      try {
        const [nextRoom, nextPlayers, nextRoomState] = await Promise.all([
          fetchRoom(room.id),
          fetchRoomPlayers(room.id),
          fetchRoomState(room.id),
        ])

        if (!isMounted) {
          return
        }

        if (!nextRoom) {
          setRoom(null)
          setPlayers([])
          setRoomState(null)
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

        if (!silent) {
          setErrorText(error instanceof Error ? error.message : 'Failed to refresh room data.')
        }
      }
    }

    const unsubscribe = subscribeToRoom({
      roomId: room.id,
      onAnyChange: refreshRoomState,
      onPrivateChange: onPrivateDataChange,
    })
    const intervalId = window.setInterval(() => {
      refreshRoomState({ silent: true })
    }, 2500)

    function refreshWhenVisible() {
      if (document.visibilityState === 'visible') {
        refreshRoomState({ silent: true })
      }
    }

    window.addEventListener('focus', refreshWhenVisible)
    document.addEventListener('visibilitychange', refreshWhenVisible)

    refreshRoomState()

    return () => {
      isMounted = false
      window.clearInterval(intervalId)
      window.removeEventListener('focus', refreshWhenVisible)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
      unsubscribe()
    }
  }, [onPrivateDataChange, room?.id, refreshTick])

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
    const maxPlayers = room?.max_players ?? MAX_ROOM_PLAYERS
    const seats = []

    for (let seatIndex = 0; seatIndex < maxPlayers; seatIndex += 1) {
      const occupant = players.find((player) => player.seat_index === seatIndex) ?? null
      seats.push({ seatIndex, occupant })
    }

    return seats
  }, [players, room?.max_players])
  const isRoomPlaying = room?.status === 'playing'
  const roomSeatCount = `${players.length}/${room?.max_players ?? MAX_ROOM_PLAYERS}`

  async function handleCreateRoom() {
    const trimmedName = normalizeDisplayName(displayName)
    setBusy(true)
    setErrorText('')

    try {
      const created = await createRoom({
        displayName: trimmedName,
        maxPlayers: MAX_ROOM_PLAYERS,
      })
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
    const trimmedName = normalizeDisplayName(displayName)
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

  if (variant === 'header') {
    return (
      <section className="online-room-panel online-room-panel--header" aria-label="Online room setup">
        <label className="online-room-header-field">
          <span>Display Name</span>
          <input
            type="text"
            value={displayName}
            onChange={(event) => setDisplayName(sanitizeDisplayNameInput(event.target.value))}
            onFocus={() => {
              if (displayName === DEFAULT_DISPLAY_NAME) {
                setDisplayName('')
              }
            }}
            maxLength={8}
            placeholder={DEFAULT_DISPLAY_NAME}
            disabled={!isSupabaseConfigured || booting || busy || Boolean(room)}
          />
        </label>

        <button
          type="button"
          disabled={!isSupabaseConfigured || booting || busy || !userId || Boolean(room)}
          onClick={handleCreateRoom}
        >
          Create Room
        </button>

        <label className="online-room-header-field">
          <span>Join Code</span>
          <input
            type="text"
            value={roomCodeInput}
            onChange={(event) => setRoomCodeInput(normalizeRoomCode(event.target.value))}
            maxLength={6}
            placeholder="ABC123"
            disabled={!isSupabaseConfigured || booting || busy || Boolean(room)}
          />
        </label>

        <button
          type="button"
          disabled={
            !isSupabaseConfigured ||
            booting ||
            busy ||
            !userId ||
            Boolean(room) ||
            roomCodeInput.length !== 6
          }
          onClick={handleJoinRoom}
        >
          Join Room
        </button>

        <span className="online-room-seat-count">{roomSeatCount}</span>

        {room ? (
          <span className="online-room-code">
            Code <b>{room.code}</b>
          </span>
        ) : null}

        {room && !isRoomPlaying && room.host_user_id === userId ? (
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
            Start
          </button>
        ) : null}

        {room ? (
          <button type="button" disabled={busy} onClick={handleLeaveRoom}>
            Leave
          </button>
        ) : null}

        {errorText ? <span className="online-room-header-error">{errorText}</span> : null}
        {!isSupabaseConfigured ? (
          <span className="online-room-header-error">Supabase env missing</span>
        ) : null}
      </section>
    )
  }

  return (
    <section className={`online-room-panel${isRoomPlaying ? ' compact' : ''}`}>
      <h3>Online Multiplayer (Supabase Rooms)</h3>

      {!isRoomPlaying ? (
        <p className="online-room-copy">
          Create or join a room for up to 8 players. Seats, ready state, and gameplay
          sync live through Supabase.
        </p>
      ) : null}

      {!isSupabaseConfigured ? (
        <p className="online-room-copy">
          Supabase is not configured yet. Add `VITE_SUPABASE_URL` and
          `VITE_SUPABASE_PUBLISHABLE_KEY` in your `.env.local`.
        </p>
      ) : null}

      {!isRoomPlaying ? (
        <div className="online-room-controls">
          <label>
            Display Name
            <input
              type="text"
              value={displayName}
              onChange={(event) => setDisplayName(sanitizeDisplayNameInput(event.target.value))}
              onFocus={() => {
                if (displayName === DEFAULT_DISPLAY_NAME) {
                  setDisplayName('')
                }
              }}
              maxLength={8}
              placeholder={DEFAULT_DISPLAY_NAME}
              disabled={booting || busy}
            />
          </label>
        </div>
      ) : null}

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
            {!isRoomPlaying ? (
              <button type="button" disabled={busy || !myPlayer} onClick={handleToggleReady}>
                {myPlayer?.is_ready ? 'Mark Not Ready' : 'Mark Ready'}
              </button>
            ) : null}
            {!isRoomPlaying && room.host_user_id === userId ? (
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
            <button
              type="button"
              disabled={busy}
              onClick={() => setRefreshTick((previous) => previous + 1)}
            >
              Refresh Room
            </button>
            <button type="button" disabled={busy} onClick={handleLeaveRoom}>
              Leave Room
            </button>
          </div>
          {!isRoomPlaying && room.host_user_id === userId && players.length < 3 ? (
            <p className="online-room-copy">
              Need at least 3 players to start this game mode.
            </p>
          ) : null}
        </div>
      )}

      {!isSupabaseConfigured || isRoomPlaying ? null : (
        <div className="online-room-seats">
          {seatRows.map((seat) => (
            <div
              key={seat.seatIndex}
              className={`seat-card${seat.occupant ? ' occupied' : ''}${seat.occupant?.is_ready ? ' ready' : ''}`}
            >
              <strong>Seat {seat.seatIndex + 1}</strong>
              {seat.occupant ? (
                <>
                  <span className="seat-name">
                    {seat.occupant.display_name}
                    {seat.occupant.user_id === userId ? ' (You)' : ''}
                  </span>
                  <span className="seat-state">
                    {seat.occupant.is_ready ? 'Ready' : 'Not Ready'}
                  </span>
                </>
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
