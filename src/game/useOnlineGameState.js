import { useCallback, useEffect, useMemo, useState } from 'react'
import { fetchAccessibleHandWords, fetchShowdownVoteStatuses } from '../multiplayer/roomApi'
import { buildWordMap, hydrateGameWithWords } from '../multiplayer/privateGameState'

function isWordGameState(candidate) {
  return (
    candidate &&
    typeof candidate === 'object' &&
    Array.isArray(candidate.players) &&
    typeof candidate.phase === 'string' &&
    typeof candidate.handNumber === 'number'
  )
}

export function useOnlineGameState({ setErrorText }) {
  const [onlineSession, setOnlineSession] = useState(null)
  const [onlineWordsByPlayerId, setOnlineWordsByPlayerId] = useState({})
  const [onlineVoteStatusRows, setOnlineVoteStatusRows] = useState([])
  const [onlinePrivateDataKey, setOnlinePrivateDataKey] = useState('')
  const [onlinePrivateRefreshTick, setOnlinePrivateRefreshTick] = useState(0)
  const [onlineGameBusy, setOnlineGameBusy] = useState(false)

  const onlineGame = useMemo(() => {
    const candidate = onlineSession?.roomState?.state_json
    return isWordGameState(candidate) ? candidate : null
  }, [onlineSession?.roomState?.state_json])
  const onlinePrivateKey =
    onlineSession?.room?.id && onlineGame?.handNumber
      ? `${onlineSession.room.id}:${onlineGame.handNumber}`
      : ''
  const activeOnlineWordsByPlayerId = useMemo(() => {
    return onlinePrivateDataKey === onlinePrivateKey ? onlineWordsByPlayerId : {}
  }, [onlinePrivateDataKey, onlinePrivateKey, onlineWordsByPlayerId])
  const activeOnlineVoteStatusRows = useMemo(() => {
    return onlinePrivateDataKey === onlinePrivateKey ? onlineVoteStatusRows : []
  }, [onlinePrivateDataKey, onlinePrivateKey, onlineVoteStatusRows])
  const hydratedOnlineGame = useMemo(() => {
    return hydrateGameWithWords(onlineGame, activeOnlineWordsByPlayerId)
  }, [activeOnlineWordsByPlayerId, onlineGame])

  const isOnlineRoomConnected = Boolean(onlineSession?.room)
  const isOnlinePlaying = Boolean(onlineSession?.room?.status === 'playing' && hydratedOnlineGame)
  const isOnlineWaiting = isOnlineRoomConnected && !isOnlinePlaying
  const onlineWaitingCopy =
    onlineSession?.room?.status === 'playing'
      ? 'Loading the online game state. Players should wait here while the room syncs.'
      : 'Online room is waiting. Wait for seats to fill, then start the online game from the room controls.'
  const myOnlineSeatIndex = onlineSession?.myPlayer?.seat_index ?? null
  const roomId = onlineSession?.room?.id ?? null
  const roomStateVersion = onlineSession?.roomState?.version ?? null
  const userId = onlineSession?.userId ?? null

  useEffect(() => {
    if (!roomId || !onlineGame?.handNumber || !roomStateVersion) {
      return undefined
    }

    let isCancelled = false
    const privateDataKey = `${roomId}:${onlineGame.handNumber}`

    async function refreshPrivateOnlineData() {
      try {
        const [wordRows, voteRows] = await Promise.all([
          fetchAccessibleHandWords({
            roomId,
            handNumber: onlineGame.handNumber,
          }),
          onlineGame.phase === 'showdownVoting'
            ? fetchShowdownVoteStatuses({
                roomId,
                handNumber: onlineGame.handNumber,
              })
            : Promise.resolve([]),
        ])

        if (isCancelled) {
          return
        }

        setOnlineWordsByPlayerId(buildWordMap(wordRows))
        setOnlineVoteStatusRows(voteRows)
        setOnlinePrivateDataKey(privateDataKey)
      } catch (error) {
        if (!isCancelled) {
          setErrorText(error instanceof Error ? error.message : 'Unable to refresh private game data.')
        }
      }
    }

    refreshPrivateOnlineData()

    return () => {
      isCancelled = true
    }
  }, [
    onlineGame?.handNumber,
    onlineGame?.phase,
    onlinePrivateRefreshTick,
    roomId,
    roomStateVersion,
    setErrorText,
  ])

  const applyOnlineCommandResult = useCallback((result) => {
    setOnlineSession((previous) => {
      if (!previous) {
        return previous
      }

      return {
        ...previous,
        roomState: result.roomState ?? previous.roomState,
        room: result.room ?? previous.room,
      }
    })
  }, [])
  const handleOnlineSessionChange = useCallback((nextSession) => {
    setOnlineSession(nextSession)
  }, [])
  const handlePrivateDataChange = useCallback(() => {
    setOnlinePrivateRefreshTick((previous) => previous + 1)
  }, [])

  return {
    activeOnlineVoteStatusRows,
    applyOnlineCommandResult,
    handleOnlineSessionChange,
    handlePrivateDataChange,
    hydratedOnlineGame,
    isOnlinePlaying,
    isOnlineRoomConnected,
    isOnlineWaiting,
    myOnlineSeatIndex,
    onlineGame,
    onlineGameBusy,
    onlineSession,
    onlineWaitingCopy,
    roomId,
    roomStateVersion,
    setOnlineGameBusy,
    setOnlinePrivateDataKey,
    setOnlineSession,
    setOnlineVoteStatusRows,
    userId,
  }
}
