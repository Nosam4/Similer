import { useEffect, useMemo, useRef, useState } from 'react'
import { isSupabaseConfigured } from '../lib/supabaseClient'
import {
  createRoom,
  ensureAnonymousSession,
  fetchRoom,
  fetchRoomPlayers,
  fetchRoomState,
  fetchRoomStateVersion,
  joinRoomByCode,
  leaveRoom,
  normalizeRoomCode,
  sanitizeDisplayNameInput,
  setReady,
  subscribeToRoom,
} from '../multiplayer/roomApi'
import {
  getReconnectRoomCode,
  getRoomExitButtonLabel,
  getRoomExitMode,
} from '../multiplayer/roomExit'
import { ROOM_FALLBACK_POLL_INTERVAL_MS, shouldPollRoom } from '../multiplayer/roomPolling'

const MAX_ROOM_PLAYERS = 8
const DISPLAY_NAME_STORAGE_KEY = 'similer.displayName'
const ROOM_CODE_STORAGE_KEY = 'similer.roomCode'
const MISSING_DISPLAY_NAME_ERROR = 'Enter your name to start.'
const REALTIME_WATCHDOG_INTERVAL_MS = 5_000
const REALTIME_HEARTBEAT_STALE_MS = 65_000
const REALTIME_RECONNECT_DELAY_MS = 400

function getPlayersSignature(players) {
  return players
    .map((player) => {
      return [
        player.user_id,
        player.seat_index,
        player.is_ready ? 1 : 0,
        player.display_name,
      ].join(':')
    })
    .sort()
    .join('|')
}

function readRememberedDisplayName() {
  if (typeof window === 'undefined') {
    return ''
  }

  try {
    return sanitizeDisplayNameInput(window.localStorage.getItem(DISPLAY_NAME_STORAGE_KEY))
  } catch {
    return ''
  }
}

function rememberDisplayName(displayName) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(DISPLAY_NAME_STORAGE_KEY, displayName)
  } catch {
    // A blocked storage API should not prevent room creation or joining.
  }
}

function readRememberedRoomCode() {
  if (typeof window === 'undefined') {
    return ''
  }

  try {
    return normalizeRoomCode(window.localStorage.getItem(ROOM_CODE_STORAGE_KEY))
  } catch {
    return ''
  }
}

function rememberRoomCode(roomCode) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    const normalizedCode = normalizeRoomCode(roomCode)

    if (normalizedCode) {
      window.localStorage.setItem(ROOM_CODE_STORAGE_KEY, normalizedCode)
    } else {
      window.localStorage.removeItem(ROOM_CODE_STORAGE_KEY)
    }
  } catch {
    // Reconnect remains available by manually entering the room code.
  }
}

function OnlineRoomPanel({
  onSessionChange = null,
  onStartOnlineGame = null,
  onPrivateDataChange = null,
  onlineGameBusy = false,
  variant = 'panel',
  initialSession = null,
}) {
  const [userId, setUserId] = useState(() => initialSession?.userId ?? '')
  const [displayName, setDisplayName] = useState(() => {
    const sessionDisplayName = initialSession?.players?.find((player) => {
      return player.user_id === initialSession?.userId
    })?.display_name

    return sanitizeDisplayNameInput(sessionDisplayName) || readRememberedDisplayName()
  })
  const [roomCodeInput, setRoomCodeInput] = useState(() => {
    return normalizeRoomCode(initialSession?.room?.code) || readRememberedRoomCode()
  })
  const [room, setRoom] = useState(() => initialSession?.room ?? null)
  const [roomState, setRoomState] = useState(() => initialSession?.roomState ?? null)
  const [players, setPlayers] = useState(() => initialSession?.players ?? [])
  const [busy, setBusy] = useState(false)
  const [errorText, setErrorText] = useState('')
  const [booting, setBooting] = useState(isSupabaseConfigured && !initialSession?.userId)
  const [refreshTick, setRefreshTick] = useState(0)
  const [connectionStatus, setConnectionStatus] = useState('reconnecting')
  const displayNameInputRef = useRef(null)
  const roomStateVersionRef = useRef(roomState?.version ?? null)
  const roomStatusRef = useRef(room?.status ?? null)
  const playersSignatureRef = useRef(getPlayersSignature(players))

  useEffect(() => {
    roomStateVersionRef.current = roomState?.version ?? null
  }, [roomState?.version])

  useEffect(() => {
    roomStatusRef.current = room?.status ?? null
  }, [room?.status])

  useEffect(() => {
    playersSignatureRef.current = getPlayersSignature(players)
  }, [players])

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
    let refreshInFlight = false
    let refreshQueued = false
    let queuedRefreshIsSilent = true
    let queuedRefreshConfirmsSubscription = false
    let realtimeStatus = 'CONNECTING'
    let versionRefreshInFlight = false
    let waitingRefreshInFlight = false
    let realtimeMissedState = false
    let realtimeMissedMembership = false
    let realtimeSnapshotConfirmed = false
    let pollingFailed = false
    let reconnectTimerId = null
    let reconnectScheduled = false
    let lastHeartbeatAt = Date.now()
    let lastActivePollAt = 0

    function setConnectionMode(nextStatus) {
      if (isMounted) {
        setConnectionStatus(nextStatus)
      }
    }

    function realtimeIsHealthy() {
      return (
        realtimeStatus === 'SUBSCRIBED' &&
        Date.now() - lastHeartbeatAt < REALTIME_HEARTBEAT_STALE_MS
      )
    }

    function getConnectionMode() {
      if (!realtimeIsHealthy()) {
        return 'reconnecting'
      }

      return realtimeSnapshotConfirmed && !realtimeMissedState && !realtimeMissedMembership && !pollingFailed
        ? 'live'
        : 'polling'
    }

    function markRealtimeEvent({ membershipEvent = false, roomStateEvent = false } = {}) {
      if (membershipEvent) {
        realtimeMissedMembership = false
      }
      if (roomStateEvent) {
        realtimeMissedState = false
      }
      if (realtimeIsHealthy()) {
        setConnectionMode(getConnectionMode())
      }
    }

    function clearRoom() {
      setRoom(null)
      setPlayers([])
      setRoomState(null)
      setConnectionMode('reconnecting')
      rememberRoomCode('')
    }

    function normalizeRealtimePlayer(player) {
      return {
        ...player,
        display_name: sanitizeDisplayNameInput(player?.display_name) || 'Player',
      }
    }

    function applyRoomChange(payload) {
      if (!isMounted) {
        return
      }

      if (payload?.eventType === 'DELETE') {
        clearRoom()
        return
      }

      markRealtimeEvent()

      if (payload?.new?.id === room.id) {
        setRoom((previous) => {
          if (previous?.updated_at && payload.new.updated_at < previous.updated_at) {
            return previous
          }

          return payload.new
        })
      }
    }

    function applyPlayerChange(payload) {
      if (!isMounted) {
        return
      }

      const changedPlayer = payload?.eventType === 'DELETE' ? payload.old : payload.new
      if (!changedPlayer?.user_id) {
        return
      }

      markRealtimeEvent({ membershipEvent: true })

      setPlayers((previous) => {
        const withoutChangedPlayer = previous.filter(
          (player) => player.user_id !== changedPlayer.user_id,
        )

        const nextPlayers =
          payload.eventType === 'DELETE'
            ? withoutChangedPlayer
            : [...withoutChangedPlayer, normalizeRealtimePlayer(changedPlayer)].sort(
                (left, right) => left.seat_index - right.seat_index,
              )

        playersSignatureRef.current = getPlayersSignature(nextPlayers)
        return nextPlayers
      })
    }

    function applyRoomStateChange(payload) {
      if (!isMounted) {
        return
      }

      if (payload?.eventType === 'DELETE') {
        setRoomState(null)
        return
      }

      if (payload?.new?.room_id === room.id) {
        markRealtimeEvent({ roomStateEvent: true })
        setRoomState((previous) => {
          return Number(previous?.version) > Number(payload.new.version) ? previous : payload.new
        })
      }
    }

    async function refreshRoomState({ confirmSubscription = false, silent = false } = {}) {
      if (refreshInFlight) {
        refreshQueued = true
        queuedRefreshIsSilent = queuedRefreshIsSilent && silent
        queuedRefreshConfirmsSubscription =
          queuedRefreshConfirmsSubscription || confirmSubscription
        return
      }

      refreshInFlight = true
      let currentRefreshIsSilent = silent
      let currentRefreshConfirmsSubscription = confirmSubscription

      try {
        do {
          refreshQueued = false
          queuedRefreshIsSilent = true
          queuedRefreshConfirmsSubscription = false

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
              clearRoom()
              return
            }

            setRoom((previous) => {
              if (previous?.updated_at && nextRoom.updated_at < previous.updated_at) {
                return previous
              }

              return nextRoom
            })
            playersSignatureRef.current = getPlayersSignature(nextPlayers)
            setPlayers(nextPlayers)
            setRoomState((previous) => {
              return Number(previous?.version) > Number(nextRoomState?.version)
                ? previous
                : nextRoomState
            })
            if (currentRefreshConfirmsSubscription && realtimeStatus === 'SUBSCRIBED') {
              realtimeSnapshotConfirmed = true
              realtimeMissedState = false
              realtimeMissedMembership = false
              pollingFailed = false
              lastActivePollAt = Date.now()
            }
            setConnectionMode(getConnectionMode())
            setErrorText('')
          } catch (error) {
            if (!isMounted) {
              return
            }

            if (currentRefreshConfirmsSubscription) {
              realtimeSnapshotConfirmed = false
              setConnectionMode('reconnecting')
              scheduleRealtimeReconnect({ refresh: false })
            }

            if (!currentRefreshIsSilent) {
              setErrorText(error instanceof Error ? error.message : 'Failed to refresh room data.')
            }
          }

          currentRefreshIsSilent = queuedRefreshIsSilent
          currentRefreshConfirmsSubscription = queuedRefreshConfirmsSubscription
        } while (isMounted && refreshQueued)
      } finally {
        refreshInFlight = false
      }
    }

    async function refreshWaitingRoomSnapshot() {
      if (
        !isMounted ||
        roomStatusRef.current === 'playing' ||
        waitingRefreshInFlight
      ) {
        return
      }

      waitingRefreshInFlight = true
      try {
        const [nextRoom, nextPlayers] = await Promise.all([
          fetchRoom(room.id),
          fetchRoomPlayers(room.id),
        ])
        if (!isMounted) {
          return
        }

        if (!nextRoom) {
          clearRoom()
          return
        }

        const nextPlayersSignature = getPlayersSignature(nextPlayers)
        pollingFailed = false
        const membershipChanged = nextPlayersSignature !== playersSignatureRef.current

        setRoom((previous) => {
          if (previous?.updated_at && nextRoom.updated_at < previous.updated_at) {
            return previous
          }

          return nextRoom
        })

        if (membershipChanged) {
          realtimeMissedMembership = true
          playersSignatureRef.current = nextPlayersSignature
          setPlayers(nextPlayers)
          setConnectionMode('polling')

          if (realtimeStatus === 'SUBSCRIBED') {
            scheduleRealtimeReconnect({ refresh: false })
          }
        } else {
          setConnectionMode(getConnectionMode())
        }

        setErrorText('')
      } catch {
        pollingFailed = true
        setConnectionMode('reconnecting')
      } finally {
        waitingRefreshInFlight = false
      }
    }

    async function refreshActiveRoomStateVersion({ force = false } = {}) {
      if (
        !isMounted ||
        roomStatusRef.current !== 'playing' ||
        versionRefreshInFlight ||
        (!force && !shouldPollRoom({
          connectionMode: getConnectionMode(),
          lastPolledAt: lastActivePollAt,
          now: Date.now(),
        }))
      ) {
        return
      }

      versionRefreshInFlight = true
      lastActivePollAt = Date.now()
      try {
        const remoteVersion = await fetchRoomStateVersion(room.id)
        if (!isMounted) {
          return
        }

        const localVersion = Number(roomStateVersionRef.current ?? 0)
        pollingFailed = false
        const numericRemoteVersion = Number(remoteVersion ?? 0)

        if (numericRemoteVersion > localVersion) {
          realtimeMissedState = true
          setConnectionMode('polling')
          const nextRoomState = await fetchRoomState(room.id)
          if (!isMounted) {
            return
          }

          setRoomState((previous) => {
            return Number(previous?.version) > Number(nextRoomState?.version)
              ? previous
              : nextRoomState
          })
          scheduleRealtimeReconnect({ refresh: false })
        }

        setConnectionMode(getConnectionMode())
      } catch {
        pollingFailed = true
        setConnectionMode('reconnecting')
      } finally {
        versionRefreshInFlight = false
      }
    }

    function scheduleRealtimeReconnect({ refresh = true } = {}) {
      if (!isMounted) {
        return
      }

      setConnectionMode('reconnecting')
      if (refresh) {
        refreshRoomState({ silent: true })
      }

      if (reconnectScheduled) {
        return
      }

      reconnectScheduled = true
      reconnectTimerId = window.setTimeout(() => {
        if (isMounted) {
          setRefreshTick((previous) => previous + 1)
        }
      }, REALTIME_RECONNECT_DELAY_MS)
    }

    const unsubscribe = subscribeToRoom({
      roomId: room.id,
      onRoomChange: applyRoomChange,
      onPlayerChange: applyPlayerChange,
      onRoomStateChange: applyRoomStateChange,
      onPrivateChange: (...args) => {
        markRealtimeEvent()
        onPrivateDataChange?.(...args)
      },
      onStatusChange: (status) => {
        realtimeStatus = status

        if (status === 'SUBSCRIBED') {
          lastHeartbeatAt = Date.now()
          realtimeSnapshotConfirmed = false
          setConnectionMode('polling')
          refreshRoomState({ confirmSubscription: true, silent: true })
        } else if (
          status === 'CHANNEL_ERROR' ||
          status === 'TIMED_OUT' ||
          status === 'CLOSED'
        ) {
          scheduleRealtimeReconnect()
        }
      },
      onHeartbeat: (status) => {
        if (status === 'ok') {
          lastHeartbeatAt = Date.now()
          if (realtimeStatus === 'SUBSCRIBED') {
            setConnectionMode(getConnectionMode())
          }
        } else if (status === 'error' || status === 'timeout' || status === 'disconnected') {
          scheduleRealtimeReconnect()
        }
      },
    })
    const activeGamePollId = window.setInterval(() => {
      refreshActiveRoomStateVersion()
    }, ROOM_FALLBACK_POLL_INTERVAL_MS)
    const waitingRoomPollId = window.setInterval(() => {
      // Lobby membership can change during subscription setup without a game
      // version bump. Keep its fallback fast so hosts can start promptly.
      refreshWaitingRoomSnapshot()
    }, ROOM_FALLBACK_POLL_INTERVAL_MS)
    const watchdogId = window.setInterval(() => {
      const now = Date.now()

      if (
        roomStatusRef.current === 'playing' &&
        (now - lastHeartbeatAt >= REALTIME_HEARTBEAT_STALE_MS ||
          realtimeStatus !== 'SUBSCRIBED')
      ) {
        scheduleRealtimeReconnect()
        return
      }

    }, REALTIME_WATCHDOG_INTERVAL_MS)

    function refreshWhenVisible() {
      if (document.visibilityState === 'visible') {
        refreshRoomState({ silent: true })
        refreshActiveRoomStateVersion({ force: true })
      }
    }

    window.addEventListener('focus', refreshWhenVisible)
    document.addEventListener('visibilitychange', refreshWhenVisible)

    refreshRoomState()

    return () => {
      isMounted = false
      window.clearInterval(activeGamePollId)
      window.clearInterval(waitingRoomPollId)
      window.clearInterval(watchdogId)
      if (reconnectTimerId !== null) {
        window.clearTimeout(reconnectTimerId)
      }
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
  const connectionLabel =
    connectionStatus === 'live'
      ? 'Live'
      : connectionStatus === 'polling'
        ? 'Polling'
        : 'Reconnecting'

  function getRequiredDisplayName() {
    const trimmedName = sanitizeDisplayNameInput(displayName)

    if (!trimmedName) {
      setErrorText(MISSING_DISPLAY_NAME_ERROR)
      displayNameInputRef.current?.focus()
      return null
    }

    return trimmedName
  }

  function handleDisplayNameChange(event) {
    const nextDisplayName = sanitizeDisplayNameInput(event.target.value)
    setDisplayName(nextDisplayName)

    if (nextDisplayName && errorText === MISSING_DISPLAY_NAME_ERROR) {
      setErrorText('')
    }
  }

  async function handleCreateRoom() {
    const trimmedName = getRequiredDisplayName()
    if (!trimmedName) {
      return
    }

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
      setConnectionStatus('reconnecting')
      setDisplayName(trimmedName)
      rememberDisplayName(trimmedName)
      rememberRoomCode(nextRoom?.code)
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Room creation failed.')
    } finally {
      setBusy(false)
    }
  }

  async function handleJoinRoom() {
    const trimmedName = getRequiredDisplayName()
    if (!trimmedName) {
      return
    }

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
      setConnectionStatus('reconnecting')
      setDisplayName(trimmedName)
      rememberDisplayName(trimmedName)
      rememberRoomCode(nextRoom?.code)
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
      const exitMode = getRoomExitMode(room)
      const reconnectCode = getReconnectRoomCode(room)

      if (exitMode === 'leave') {
        await leaveRoom({ roomId: room.id })
      }

      setRoom(null)
      setRoomState(null)
      setPlayers([])
      setConnectionStatus('reconnecting')
      setRoomCodeInput(reconnectCode)
      rememberRoomCode(reconnectCode)
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
          <span>Your Name</span>
          <input
            ref={displayNameInputRef}
            type="text"
            value={displayName}
            onChange={handleDisplayNameChange}
            maxLength={8}
            placeholder="Enter your name"
            autoComplete="nickname"
            required
            aria-invalid={errorText === MISSING_DISPLAY_NAME_ERROR}
            aria-describedby={errorText ? 'online-room-error' : undefined}
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

        {room ? (
          <span
            className={`online-room-connection online-room-connection--${connectionStatus}`}
            title="Multiplayer synchronization status and room-state version"
            role="status"
          >
            <span className="online-room-connection-dot" aria-hidden="true" />
            {connectionLabel} · v{roomState?.version ?? '—'}
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
          <button
            type="button"
            disabled={busy}
            onClick={handleLeaveRoom}
            title={isRoomPlaying ? 'Disconnect and keep your seat available for rejoining.' : undefined}
          >
            {getRoomExitButtonLabel(room)}
          </button>
        ) : null}

        {errorText ? (
          <span id="online-room-error" className="online-room-header-error" role="alert">
            {errorText}
          </span>
        ) : null}
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
            Your Name
            <input
              ref={displayNameInputRef}
              type="text"
              value={displayName}
              onChange={handleDisplayNameChange}
              maxLength={8}
              placeholder="Enter your name"
              autoComplete="nickname"
              required
              aria-invalid={errorText === MISSING_DISPLAY_NAME_ERROR}
              aria-describedby={errorText ? 'online-room-error' : undefined}
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
          <p className="online-room-connection-detail" role="status">
            Sync: <b>{connectionLabel}</b> · State version <b>{roomState?.version ?? '—'}</b>
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
              {getRoomExitButtonLabel(room)} Room
            </button>
          </div>
          {isRoomPlaying ? (
            <p className="online-room-copy">
              Disconnect keeps your seat. Rejoin this active game with the same
              room code and browser profile.
            </p>
          ) : null}
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

      {errorText ? (
        <p id="online-room-error" className="error-text" role="alert">
          {errorText}
        </p>
      ) : null}
    </section>
  )
}

export default OnlineRoomPanel
