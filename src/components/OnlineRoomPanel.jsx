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
import './OnlineRoomPanel.css'

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

function readInvitationRoomCode() {
  if (typeof window === 'undefined') {
    return ''
  }

  return normalizeRoomCode(new URLSearchParams(window.location.search).get('room'))
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
  onPractice = null,
  externalError = '',
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
    return normalizeRoomCode(initialSession?.room?.code) || readInvitationRoomCode() || readRememberedRoomCode()
  })
  const [room, setRoom] = useState(() => initialSession?.room ?? null)
  const [roomState, setRoomState] = useState(() => initialSession?.roomState ?? null)
  const [players, setPlayers] = useState(() => initialSession?.players ?? [])
  const [busy, setBusy] = useState(false)
  const [errorText, setErrorText] = useState('')
  const [booting, setBooting] = useState(isSupabaseConfigured && !initialSession?.userId)
  const [refreshTick, setRefreshTick] = useState(0)
  const [connectionStatus, setConnectionStatus] = useState('reconnecting')
  const [copyStatus, setCopyStatus] = useState('')
  const [manualInvite, setManualInvite] = useState('')
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
  const visibleError = errorText || externalError
  const isHost = room?.host_user_id === userId
  const entryDisabled = !isSupabaseConfigured || booting || busy || !userId

  async function handleCopyInvitation() {
    if (!room?.code || typeof window === 'undefined') {
      return
    }

    const invitationUrl = new URL(window.location.href)
    invitationUrl.search = ''
    invitationUrl.hash = ''
    invitationUrl.searchParams.set('room', room.code)

    try {
      await window.navigator.clipboard.writeText(invitationUrl.toString())
      setCopyStatus('Invitation link copied. Send it to your friends.')
      setManualInvite('')
    } catch {
      setCopyStatus('Copy this invitation link, or share the room code.')
      setManualInvite(invitationUrl.toString())
    }
  }

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
    setCopyStatus('')
    setManualInvite('')

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
    setCopyStatus('')
    setManualInvite('')

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
      setCopyStatus('')
      setManualInvite('')
      rememberRoomCode(reconnectCode)
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Leave room failed.')
    } finally {
      setBusy(false)
    }
  }

  const connectionBadge = room ? (
    <span
      className={`online-room-connection online-room-connection--${connectionStatus}`}
      title={`Room connection: ${connectionLabel}. State version ${roomState?.version ?? '—'}.`}
      aria-label={`${connectionLabel} · v${roomState?.version ?? '—'}`}
      role="status"
    >
      <span className="online-room-connection-dot" aria-hidden="true" />
      {connectionLabel}<span className="room-sr-only"> · v{roomState?.version ?? '—'}</span>
    </span>
  ) : null

  const invitationFeedback = (
    <>
      {copyStatus ? <p className="room-copy-status" role="status">{copyStatus}</p> : null}
      {manualInvite ? (
        <label className="room-manual-invite">
          Invitation link
          <input value={manualInvite} readOnly onFocus={(event) => event.target.select()} />
        </label>
      ) : null}
    </>
  )

  if (variant === 'header') {
    if (!room) {
      return null
    }

    return (
      <section className="online-room-panel online-room-panel--header room-hub" aria-label="Your online room">
        <span className="online-room-code">Room <b>{room.code}</b></span>
        <button type="button" onClick={handleCopyInvitation} aria-label="Copy invitation link">Copy invite</button>
        <span className="online-room-seat-count" aria-label={`${players.length} players in room`}>{roomSeatCount}</span>
        {connectionBadge}
        <button
          type="button"
          disabled={busy}
          onClick={handleLeaveRoom}
          title={isRoomPlaying ? 'Disconnect and keep your seat available for rejoining.' : undefined}
        >
          {getRoomExitButtonLabel(room)}
        </button>
        {invitationFeedback}
        {visibleError ? <p id="online-room-error" className="room-error" role="alert">{visibleError}</p> : null}
      </section>
    )
  }

  return (
    <section className={`online-room-panel room-hub ${room ? 'room-hub--lobby' : 'room-hub--welcome'}`} aria-labelledby="room-hub-title">
      {!room ? (
        <>
          <div className="room-welcome-story">
            <span className="room-eyebrow">A word game with a poker face</span>
            <h1 id="room-hub-title">Good words.<br /><em>Better arguments.</em></h1>
            <p className="room-lead">Bet on your word, argue its connection, and win the table’s vote.</p>
            <div className="room-game-facts">
              <span>3–8 friends</span><span>One device each</span><span>No account needed</span>
            </div>
            <div className="room-how-it-works" aria-label="How to play">
              <div><span className="room-step-number">01</span><strong>Peek & bet</strong><p>You get one hidden word. Peek privately, then decide how much to bet.</p></div>
              <div><span className="room-step-number">02</span><strong>Make your case</strong><p>Explain why your word connects best. A clever argument can change everything.</p></div>
              <div><span className="room-step-number">03</span><strong>Vote & win</strong><p>Player votes, the Judge, and word similarity decide who wins the pot.</p></div>
            </div>
            <p className="room-voice-note">Play in the same room or hop on a voice call so everyone can hear the arguments.</p>
          </div>

          <div className="room-entry-card">
            <span className="room-eyebrow">Bring your people</span>
            <h2>Meet at the table.</h2>
            <p>Create a private room, or join a friend’s game.</p>
            <label className="room-field">
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
                aria-describedby={visibleError ? 'online-room-error' : undefined}
                disabled={!isSupabaseConfigured || booting || busy}
              />
            </label>
            <button className="room-primary" type="button" disabled={entryDisabled} onClick={handleCreateRoom}>
              Create Room
            </button>
            <div className="room-entry-divider"><span>or join your friends</span></div>
            <div className="room-join-row">
              <label className="room-field">
                Join Code
                <input
                  type="text"
                  value={roomCodeInput}
                  onChange={(event) => setRoomCodeInput(normalizeRoomCode(event.target.value))}
                  maxLength={6}
                  placeholder="ABC123"
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  disabled={entryDisabled}
                />
              </label>
              <button type="button" disabled={entryDisabled || roomCodeInput.length !== 6} onClick={handleJoinRoom}>
                Join Room
              </button>
            </div>
            {booting ? <p className="room-entry-status" role="status">Connecting to online play…</p> : null}
            {busy ? <p className="room-entry-status" role="status">Finding your seat…</p> : null}
            {!isSupabaseConfigured ? <p className="room-entry-status">Online play is unavailable right now. You can still try a practice round.</p> : null}
            {visibleError ? <p id="online-room-error" className="room-error" role="alert">{visibleError}</p> : null}
            {onPractice ? <button className="room-practice" type="button" onClick={onPractice} disabled={busy}>Practice locally <span aria-hidden="true">↗</span></button> : null}
          </div>
        </>
      ) : (
        <>
          <header className="room-lobby-heading">
            <div>
              <span className="room-eyebrow">Your table is taking shape</span>
              <h1 id="room-hub-title">{isRoomPlaying ? 'Taking your seat…' : 'Gather your friends.'}</h1>
              <p>{isRoomPlaying ? 'Your game is starting. The table will open in a moment.' : 'Share the invitation, get comfortable, and make your case.'}</p>
            </div>
            {connectionBadge}
          </header>
          <div className="room-lobby-grid">
            <div className="room-roster-panel">
              <div className="room-roster-heading">
                <h2>At the table</h2>
                <span className="online-room-seat-count" aria-label={`${players.length} of ${room.max_players ?? MAX_ROOM_PLAYERS} seats filled`}>{roomSeatCount}</span>
              </div>
              <ol className="room-roster" aria-label="Players and open seats">
                {seatRows.map(({ seatIndex, occupant }) => (
                  <li key={seatIndex} className={`room-seat${occupant ? ' room-seat--occupied' : ''}${occupant?.user_id === userId ? ' room-seat--you' : ''}`}>
                    <span className="room-seat-avatar" aria-hidden="true">{occupant ? occupant.display_name.slice(0, 1).toUpperCase() : '+'}</span>
                    <div className="room-seat-identity">
                      <strong>{occupant ? occupant.display_name : 'Open seat'}{occupant?.user_id === userId ? <span className="room-you-label">You</span> : null}</strong>
                      <span>{occupant ? (occupant.user_id === room.host_user_id ? 'Host' : `Player ${seatIndex + 1}`) : 'Invite a friend'}</span>
                    </div>
                    {occupant ? <span className={`room-ready-badge${occupant.is_ready ? ' is-ready' : ''}`}>{occupant.is_ready ? 'Ready' : 'Not ready'}</span> : null}
                  </li>
                ))}
              </ol>
            </div>
            <aside className="room-invite-panel" aria-label="Room invitation and controls">
              <span className="room-eyebrow">Your private room</span>
              <div className="online-room-code"><span>Room code</span><b>{room.code}</b></div>
              <button type="button" className="room-invite-button" onClick={handleCopyInvitation} aria-label="Copy invitation link">Copy invite link <span aria-hidden="true">↗</span></button>
              {invitationFeedback}
              <p className="room-voice-note">Everyone needs their own device. Join a voice call or play together in the same room.</p>
              <div className="room-start-controls">
                <p className="room-start-hint" role="status">
                  {isRoomPlaying
                    ? 'Opening the game…'
                    : players.length < 3
                      ? `Waiting for ${3 - players.length} more ${players.length === 2 ? 'friend' : 'friends'}. You need at least 3 players to start.`
                      : isHost
                        ? 'Your table is ready to play. Start whenever everyone is here.'
                        : 'The host will start the game when everyone is here.'}
                </p>
                {!isRoomPlaying ? (
                  <>
                    <button type="button" className="room-ready-button" aria-pressed={Boolean(myPlayer?.is_ready)} disabled={busy || !myPlayer} onClick={handleToggleReady}>
                      {myPlayer?.is_ready ? 'Ready ✓' : 'I’m ready'}
                    </button>
                    {isHost ? (
                      <button
                        type="button"
                        className="room-primary"
                        disabled={busy || onlineGameBusy || !onStartOnlineGame || players.length < 3}
                        onClick={onStartOnlineGame}
                      >
                        {onlineGameBusy ? 'Starting…' : 'Start'}
                      </button>
                    ) : null}
                    <p className="room-readiness-note">Ready lets the table know you’re set. The host can start with 3 or more players.</p>
                  </>
                ) : null}
                <button type="button" className="room-leave" disabled={busy || onlineGameBusy} onClick={handleLeaveRoom}>{getRoomExitButtonLabel(room)}</button>
              </div>
              {visibleError ? <p id="online-room-error" className="room-error" role="alert">{visibleError}</p> : null}
            </aside>
          </div>
        </>
      )}
    </section>
  )
}

export default OnlineRoomPanel
