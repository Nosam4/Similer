import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import {
  applyPlayerAction,
  completeDebateStage,
  createInitialGame,
  getContenders,
  getCurrentActor,
  getJudgePlayer,
  getLegalActions,
  getPhaseLabel,
  getPotSummary,
  getSimilarityForWords,
  getWordBankSize,
  resolveShowdownVotes,
  startNextHand,
} from './wordgame/engine'
import ActionLogPanel from './components/ActionLogPanel'
import BustedPanel from './components/BustedPanel'
import ConfettiComponent from './components/ConfettiComponent'
import DebatePanel from './components/DebatePanel'
import HandCompletePanel from './components/HandCompletePanel'
import JudgeRow from './components/JudgeRow'
import OnlineRoomPanel from './components/OnlineRoomPanel'
import PlayersGrid from './components/PlayersGrid'
import ShowdownVotingPanel from './components/ShowdownVotingPanel'
import StatusRow from './components/StatusRow'
import TableHeader from './components/TableHeader'
import TurnPanel from './components/TurnPanel'
import {
  fetchAccessibleHandWords,
  fetchShowdownVotesForResolution,
  fetchShowdownVoteStatuses,
  replaceHandWords,
  revealHandWords,
  revealJudgeWord,
  saveRoomState,
  setRoomStatus,
  submitShowdownVote,
} from './multiplayer/roomApi'
import {
  applyRevealedWordsToGame,
  buildSubmittedPlayerVoteIds,
  buildVotesPayload,
  buildWordMap,
  extractPrivateHandWords,
  getPublicRevealPlayerIds,
  hasSubmittedJudgeVote,
  hydrateGameWithWords,
  sanitizeGameForRoomState,
} from './multiplayer/privateGameState'

const PLAYER_NAMES = ['North', 'East', 'South', 'West']
const STARTING_STACK = 400
const SMALL_BLIND = 5
const BIG_BLIND = 10
const TURN_WAIT_ERROR = 'It is not your turn yet.'
const INITIAL_PULSE_TICKS = {
  phaseTile: 0,
  judgeRow: 0,
  showdownPanel: 0,
  debatePanel: 0,
  turnPanel: 0,
  handPanel: 0,
  winnerLine: 0,
}

function isWordGameState(candidate) {
  return (
    candidate &&
    typeof candidate === 'object' &&
    Array.isArray(candidate.players) &&
    typeof candidate.phase === 'string' &&
    typeof candidate.handNumber === 'number'
  )
}

function getOnlinePlayerNames(players) {
  const names = [...players]
    .sort((left, right) => left.seat_index - right.seat_index)
    .map((player) => String(player.display_name).trim())
    .filter(Boolean)

  return names.length >= 3 ? names : PLAYER_NAMES
}

function getRestartPlayerNames(game, onlineSession) {
  if (onlineSession?.players?.length >= 3) {
    return getOnlinePlayerNames(onlineSession.players)
  }

  return game.players.map((player) => player.name)
}

function App() {
  const [localGame, setLocalGame] = useState(() => {
    return createInitialGame({
      playerNames: PLAYER_NAMES,
      startingStack: STARTING_STACK,
      smallBlind: SMALL_BLIND,
      bigBlind: BIG_BLIND,
    })
  })
  const [amountInput, setAmountInput] = useState('')
  const [errorText, setErrorText] = useState('')
  const [revealByPlayerId, setRevealByPlayerId] = useState({})
  const [playerVotes, setPlayerVotes] = useState({})
  const [judgeVote, setJudgeVote] = useState('')
  const [onlineSession, setOnlineSession] = useState(null)
  const [onlineWordsByPlayerId, setOnlineWordsByPlayerId] = useState({})
  const [onlineVoteStatusRows, setOnlineVoteStatusRows] = useState([])
  const [onlinePrivateDataKey, setOnlinePrivateDataKey] = useState('')
  const [onlineGameBusy, setOnlineGameBusy] = useState(false)
  const [pulseTicks, setPulseTicks] = useState(INITIAL_PULSE_TICKS)
  const previousPhaseRef = useRef(null)

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

  const isOnlinePlaying = Boolean(onlineSession?.room?.status === 'playing' && hydratedOnlineGame)
  const game = isOnlinePlaying ? hydratedOnlineGame : localGame

  const actor = getCurrentActor(game)
  const legal = getLegalActions(game)
  const potSummary = getPotSummary(game)
  const judge = getJudgePlayer(game)
  const contenders = getContenders(game)

  const isShowdownVoting = game.phase === 'showdownVoting'
  const isDebate = game.phase === 'debate'
  const judgeWord = game.judgeWord ?? judge?.holeWord ?? null
  const isFinalDuel = game.showdownMode === 'similarityDuel'
  const isNeutralVoting = game.showdownMode === 'neutralVoting'
  const onlineSubmittedPlayerVoteIds = useMemo(() => {
    return buildSubmittedPlayerVoteIds(activeOnlineVoteStatusRows)
  }, [activeOnlineVoteStatusRows])

  const similarityRows = useMemo(() => {
    if (!judgeWord || !isShowdownVoting) {
      return []
    }

    return contenders.map((player) => {
      return {
        playerId: player.id,
        playerName: player.name,
        playerWord: player.holeWord,
        similarity: getSimilarityForWords(player.holeWord, judgeWord),
      }
    })
  }, [contenders, isShowdownVoting, judgeWord])

  const defaultPlayerVotes = useMemo(() => {
    if (!isShowdownVoting || contenders.length === 0) {
      return {}
    }

    const defaults = {}

    for (const voter of contenders) {
      const fallback = contenders.find((candidate) => candidate.id !== voter.id)
      defaults[voter.id] = String((fallback ?? voter).id)
    }

    return defaults
  }, [contenders, isShowdownVoting])

  const effectivePlayerVotes =
    isOnlinePlaying
      ? {}
      : Object.keys(playerVotes).length > 0
        ? playerVotes
        : defaultPlayerVotes
  const effectiveJudgeVote =
    judge
      ? isOnlinePlaying
        ? ''
        : judgeVote || (contenders.length > 0 ? String(contenders[0].id) : '')
      : ''
  const submittedPlayerVoteCount = isOnlinePlaying
    ? onlineSubmittedPlayerVoteIds.length
    : contenders.filter((voter) => {
        const value = effectivePlayerVotes[voter.id]
        const targetId = Number(value)

        return (
          value !== undefined &&
          value !== '' &&
          targetId !== voter.id &&
          contenders.some((target) => target.id === targetId)
        )
      }).length
  const judgeVoteSubmitted = isOnlinePlaying
    ? !judge || hasSubmittedJudgeVote(activeOnlineVoteStatusRows)
    : !judge || effectiveJudgeVote !== ''

  const canResolveVotes =
    isShowdownVoting &&
    contenders.length > 1 &&
    (isOnlinePlaying
      ? submittedPlayerVoteCount === contenders.length && judgeVoteSubmitted
      : contenders.every((voter) => {
          const value = effectivePlayerVotes[voter.id]
          const targetId = Number(value)

          return (
            value !== undefined &&
            value !== '' &&
            targetId !== voter.id &&
            contenders.some((target) => target.id === targetId)
          )
        }) &&
        (!judge || effectiveJudgeVote !== ''))

  const myOnlineSeatIndex = onlineSession?.myPlayer?.seat_index ?? null
  const roomId = onlineSession?.room?.id ?? null
  const roomStateVersion = onlineSession?.roomState?.version ?? null
  const userId = onlineSession?.userId ?? null

  useEffect(() => {
    if (!roomId || !onlineGame?.handNumber || !onlineSession?.roomState) {
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
  }, [onlineGame?.handNumber, onlineGame?.phase, onlineSession?.roomState, roomId])

  const persistOnlineGame = useCallback(
    async (nextGame, nextStatus = null, options = {}) => {
      if (!roomId || !userId) {
        throw new Error('No active room is connected.')
      }

      const { replacePrivateWords = false, revealPublicWords = false } = options

      let stateToSave = sanitizeGameForRoomState(nextGame)
      const savedRoomState = await saveRoomState({
        roomId,
        nextState: stateToSave,
        updatedByUserId: userId,
        expectedVersion: roomStateVersion,
      })
      let finalRoomState = savedRoomState

      if (replacePrivateWords) {
        await replaceHandWords({
          roomId,
          handNumber: nextGame.handNumber,
          words: extractPrivateHandWords(nextGame),
        })
      }

      if (nextStatus) {
        await setRoomStatus({
          roomId,
          hostUserId: onlineSession?.room?.host_user_id,
          status: nextStatus,
        })
      }

      if (revealPublicWords) {
        const revealedRows = []
        const savedGame = savedRoomState.state_json
        const savedPlayers = savedGame?.players ?? []
        const savedJudge = savedPlayers.find((player) => player.id === savedGame?.judgePlayerId)

        if (
          savedGame?.judgePlayerId !== null &&
          savedGame?.judgePlayerId !== undefined &&
          (!savedGame.judgeWord || !savedJudge?.holeWord)
        ) {
          const judgeRows = await revealJudgeWord({
            roomId,
            handNumber: savedGame.handNumber,
            playerId: savedGame.judgePlayerId,
          })
          revealedRows.push(...judgeRows)
        }

        const revealPlayerIds = getPublicRevealPlayerIds(savedGame).filter((playerId) => {
          return !savedPlayers.find((player) => player.id === playerId)?.holeWord
        })

        if (revealPlayerIds.length > 0) {
          const playerRows = await revealHandWords({
            roomId,
            handNumber: savedGame.handNumber,
            playerIds: revealPlayerIds,
          })
          revealedRows.push(...playerRows)
        }

        if (revealedRows.length > 0) {
          stateToSave = sanitizeGameForRoomState(
            applyRevealedWordsToGame(nextGame, revealedRows),
          )
          finalRoomState = await saveRoomState({
            roomId,
            nextState: stateToSave,
            updatedByUserId: userId,
            expectedVersion: savedRoomState.version,
          })
          setOnlineWordsByPlayerId((previous) => ({
            ...previous,
            ...buildWordMap(revealedRows),
          }))
          setOnlinePrivateDataKey(`${roomId}:${savedGame.handNumber}`)
        }
      }

      setOnlineSession((previous) => {
        if (!previous) {
          return previous
        }

        return {
          ...previous,
          roomState: finalRoomState,
          room: nextStatus
            ? {
                ...previous.room,
                status: nextStatus,
              }
            : previous.room,
        }
      })
    },
    [onlineSession?.room?.host_user_id, roomId, roomStateVersion, userId],
  )

  useEffect(() => {
    const previousPhase = previousPhaseRef.current

    if (previousPhase === null) {
      previousPhaseRef.current = game.phase
      return
    }

    if (previousPhase === game.phase) {
      return
    }

    previousPhaseRef.current = game.phase

    setPulseTicks((previous) => {
      const next = {
        ...previous,
        phaseTile: previous.phaseTile + 1,
      }

      if (game.phase === 'preflop') {
        next.turnPanel += 1
      } else if (game.phase === 'postflop') {
        next.judgeRow += 1
      } else if (game.phase === 'debate') {
        next.debatePanel += 1
      } else if (game.phase === 'showdownVoting') {
        next.showdownPanel += 1
      } else if (game.phase === 'handComplete') {
        next.handPanel += 1
        next.winnerLine += 1
      }

      return next
    })
  }, [game.phase])

  async function runAction(type, amountOverride) {
    try {
      const nextGame = applyPlayerAction(
        game,
        type,
        amountOverride ?? Number(amountInput),
      )
      if (isOnlinePlaying) {
        setOnlineGameBusy(true)
        await persistOnlineGame(nextGame, null, { revealPublicWords: true })
      } else {
        setLocalGame(nextGame)
      }
      setErrorText('')

      const nextLegal = getLegalActions(nextGame)
      if (nextLegal.raise) {
        setAmountInput(String(nextLegal.minRaiseTo))
      } else if (nextLegal.bet) {
        setAmountInput(String(nextLegal.minBetTo))
      }
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Action failed.')
    } finally {
      setOnlineGameBusy(false)
    }
  }

  async function beginNextHand() {
    const nextGame = startNextHand(game)
    try {
      if (isOnlinePlaying) {
        setOnlineGameBusy(true)
        await persistOnlineGame(nextGame, null, {
          replacePrivateWords: true,
          revealPublicWords: true,
        })
      } else {
        setLocalGame(nextGame)
      }
      setErrorText('')
      setAmountInput('')
      setPlayerVotes({})
      setJudgeVote('')
      setRevealByPlayerId({})
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Could not start next hand.')
    } finally {
      setOnlineGameBusy(false)
    }
  }

  async function startNewGame() {
    const nextGame = createInitialGame({
      playerNames: getRestartPlayerNames(game, onlineSession),
      startingStack: STARTING_STACK,
      smallBlind: SMALL_BLIND,
      bigBlind: BIG_BLIND,
    })

    try {
      if (isOnlinePlaying) {
        setOnlineGameBusy(true)
        await persistOnlineGame(nextGame, null, {
          replacePrivateWords: true,
          revealPublicWords: true,
        })
      } else {
        setLocalGame(nextGame)
      }
      setErrorText('')
      setAmountInput('')
      setPlayerVotes({})
      setJudgeVote('')
      setRevealByPlayerId({})
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Could not start a new game.')
    } finally {
      setOnlineGameBusy(false)
    }
  }

  async function resolveVotes() {
    try {
      if (isOnlinePlaying && !canResolveVotes) {
        setErrorText('Waiting for all showdown votes.')
        return
      }

      let playerVotesForResolution = effectivePlayerVotes
      let judgeVoteForResolution = judge ? Number(effectiveJudgeVote) : null

      if (isOnlinePlaying) {
        const voteRows = await fetchShowdownVotesForResolution({
          roomId,
          handNumber: game.handNumber,
        })
        const privateVotes = buildVotesPayload(voteRows)
        playerVotesForResolution = privateVotes.playerVotes
        judgeVoteForResolution = judge ? Number(privateVotes.judgeVote) : null
      }

      const nextGame = resolveShowdownVotes(game, {
        playerVotes: playerVotesForResolution,
        judgeVote: judgeVoteForResolution,
      })
      if (isOnlinePlaying) {
        setOnlineGameBusy(true)
        await persistOnlineGame(nextGame, null, { revealPublicWords: true })
      } else {
        setLocalGame(nextGame)
      }
      setErrorText('')
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Vote resolution failed.')
    } finally {
      setOnlineGameBusy(false)
    }
  }

  async function completeDebate() {
    try {
      const nextGame = completeDebateStage(game)
      if (isOnlinePlaying) {
        setOnlineGameBusy(true)
        await persistOnlineGame(nextGame, null, { revealPublicWords: true })
      } else {
        setLocalGame(nextGame)
      }
      setErrorText('')
      setPlayerVotes({})
      setJudgeVote('')
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Could not complete debate.')
    } finally {
      setOnlineGameBusy(false)
    }
  }

  async function submitOnlinePlayerVote() {
    const selectedVote = onlinePlayerVoteValue
    const voterId = myOnlineSeatIndex
    const targetId = Number(selectedVote)

    if (!isOnlinePlaying || !isShowdownVoting || voterId === null) {
      return
    }

    if (!contenders.some((player) => player.id === voterId)) {
      setErrorText('Only active contenders submit player votes.')
      return
    }

    if (!contenders.some((player) => player.id === targetId)) {
      setErrorText('Choose a valid player vote before submitting.')
      return
    }

    if (targetId === voterId) {
      setErrorText('Choose another player. You cannot vote for your own word.')
      return
    }

    try {
      setOnlineGameBusy(true)
      await submitShowdownVote({
        roomId,
        handNumber: game.handNumber,
        voterPlayerId: voterId,
        voteType: 'player',
        targetPlayerId: targetId,
      })
      setOnlineVoteStatusRows((previous) => {
        const filtered = previous.filter((row) => {
          return !(row.vote_type === 'player' && Number(row.voter_player_id) === voterId)
        })

        return [
          ...filtered,
          {
            vote_type: 'player',
            voter_player_id: voterId,
            submitted: true,
          },
        ]
      })
      setOnlinePrivateDataKey(`${roomId}:${game.handNumber}`)
      setErrorText('')
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Unable to submit player vote.')
    } finally {
      setOnlineGameBusy(false)
    }
  }

  async function submitOnlineJudgeVote() {
    const targetId = Number(onlineJudgeVoteValue)

    if (!isOnlinePlaying || !isShowdownVoting || judge?.id !== myOnlineSeatIndex) {
      return
    }

    if (!contenders.some((player) => player.id === targetId)) {
      setErrorText('Choose a valid judge vote before submitting.')
      return
    }

    try {
      setOnlineGameBusy(true)
      await submitShowdownVote({
        roomId,
        handNumber: game.handNumber,
        voterPlayerId: myOnlineSeatIndex,
        voteType: 'judge',
        targetPlayerId: targetId,
      })
      setOnlineVoteStatusRows((previous) => {
        const filtered = previous.filter((row) => row.vote_type !== 'judge')

        return [
          ...filtered,
          {
            vote_type: 'judge',
            voter_player_id: myOnlineSeatIndex,
            submitted: true,
          },
        ]
      })
      setOnlinePrivateDataKey(`${roomId}:${game.handNumber}`)
      setErrorText('')
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Unable to submit judge vote.')
    } finally {
      setOnlineGameBusy(false)
    }
  }

  const handleOnlineSessionChange = useCallback((nextSession) => {
    setOnlineSession(nextSession)
  }, [])

  async function handleStartOnlineGame() {
    if (!onlineSession?.room?.id || !userId) {
      setErrorText('Join a room before starting an online game.')
      return
    }

    if (onlineSession.room.host_user_id !== userId) {
      setErrorText('Only the room host can start the online game.')
      return
    }

    try {
      setOnlineGameBusy(true)
      const onlinePlayerNames = getOnlinePlayerNames(onlineSession.players)
      const initialSharedGame = createInitialGame({
        playerNames: onlinePlayerNames,
        startingStack: STARTING_STACK,
        smallBlind: SMALL_BLIND,
        bigBlind: BIG_BLIND,
      })

      await persistOnlineGame(initialSharedGame, 'playing', {
        replacePrivateWords: true,
        revealPublicWords: true,
      })

      setErrorText('')
      setAmountInput('')
      setPlayerVotes({})
      setJudgeVote('')
      setRevealByPlayerId({})
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Unable to start online game.')
    } finally {
      setOnlineGameBusy(false)
    }
  }

  const myOnlinePlayer =
    isOnlinePlaying && myOnlineSeatIndex !== null
      ? game.players.find((player) => player.id === myOnlineSeatIndex) ?? null
      : null
  const isBustedOnline = Boolean(
    isOnlinePlaying &&
      myOnlinePlayer &&
      myOnlinePlayer.stack <= 0 &&
      !myOnlinePlayer.inHand,
  )
  const canCompleteDebate =
    !isOnlinePlaying ||
    contenders.some((player) => player.id === myOnlineSeatIndex) ||
    judge?.id === myOnlineSeatIndex
  const isMyTurnOnline = isOnlinePlaying && actor && actor.id === myOnlineSeatIndex
  const onlinePlayerVoteValue =
    myOnlineSeatIndex === null ? '' : playerVotes[myOnlineSeatIndex] ?? ''
  const onlineJudgeVoteValue = judgeVote
  const effectiveRevealByPlayerId = useMemo(() => {
    if (!isOnlinePlaying || myOnlineSeatIndex === null) {
      return revealByPlayerId
    }

    return {
      ...revealByPlayerId,
      [myOnlineSeatIndex]: true,
    }
  }, [isOnlinePlaying, myOnlineSeatIndex, revealByPlayerId])
  const tableWinner = game.tableComplete
    ? game.players.find((player) => player.stack > 0) ?? null
    : null
  const tableLoserOnline = Boolean(
    isOnlinePlaying &&
      game.tableComplete &&
      tableWinner &&
      myOnlinePlayer &&
      myOnlinePlayer.id !== tableWinner.id,
  )
  const handPayoutConfettiActive =
    game.handComplete &&
    (game.showdown?.payouts ?? []).some((payout) => {
      if (payout.amount <= 0) {
        return false
      }

      return !isOnlinePlaying || payout.playerId === myOnlineSeatIndex
    })
  const tableConfettiActive = Boolean(
    game.tableComplete && tableWinner && (!isOnlinePlaying || myOnlinePlayer),
  )
  const confettiActive =
    handPayoutConfettiActive ||
    tableConfettiActive
  const confettiMode = game.tableComplete
    ? tableLoserOnline
      ? 'loser'
      : 'winner'
    : 'chips'
  const confettiKey = game.tableComplete
    ? `table-${tableWinner?.id ?? 'none'}-${confettiMode}`
    : `hand-${game.handNumber}-${confettiMode}`
  const shouldHideTurnWaitError =
    errorText === TURN_WAIT_ERROR &&
    isOnlinePlaying &&
    (isMyTurnOnline || isBustedOnline || isDebate || isShowdownVoting || game.handComplete)
  const visibleErrorText =
    shouldHideTurnWaitError ? '' : errorText

  function toggleWordReveal(playerId) {
    if (isOnlinePlaying && myOnlineSeatIndex !== null && playerId !== myOnlineSeatIndex) {
      return
    }

    setRevealByPlayerId((previous) => {
      return {
        ...previous,
        [playerId]: !previous[playerId],
      }
    })
  }

  return (
    <main className="table-shell">
      <ConfettiComponent key={confettiKey} active={confettiActive} mode={confettiMode} />

      <OnlineRoomPanel
        onSessionChange={handleOnlineSessionChange}
        onStartOnlineGame={handleStartOnlineGame}
        onlineGameBusy={onlineGameBusy}
      />

      <TableHeader />

      <StatusRow
        handNumber={game.handNumber}
        phaseLabel={getPhaseLabel(game.phase)}
        potSummary={potSummary}
        wordBankSize={getWordBankSize()}
        phasePulseTick={pulseTicks.phaseTile}
      />

      <JudgeRow judge={judge} judgeWord={judgeWord} pulseTick={pulseTicks.judgeRow} />

      <PlayersGrid
        players={game.players}
        dealerIndex={game.dealerIndex}
        currentPlayerIndex={game.currentPlayerIndex}
        phase={game.phase}
        handComplete={game.handComplete}
        revealByPlayerId={effectiveRevealByPlayerId}
        onToggleWordReveal={toggleWordReveal}
        showWordControls={!isOnlinePlaying}
      />

      <section className="controls">
        {game.tableComplete ? (
          <div className="notice">
            <p>Table over: only one player has chips remaining.</p>
          </div>
        ) : null}

        {isBustedOnline && !game.handComplete ? (
          <BustedPanel playerName={myOnlinePlayer?.name} />
        ) : game.handComplete ? (
          <HandCompletePanel
            game={game}
            onBeginNextHand={beginNextHand}
            onStartNewGame={startNewGame}
            actionDisabled={onlineGameBusy}
            pulseTick={pulseTicks.handPanel}
            winnerPulseTick={pulseTicks.winnerLine}
          />
        ) : isDebate ? (
          <DebatePanel
            judge={judge}
            judgeWord={judgeWord}
            contenders={contenders}
            isFinalDuel={isFinalDuel}
            isNeutralVoting={isNeutralVoting}
            canCompleteDebate={canCompleteDebate}
            onCompleteDebate={completeDebate}
            onlineGameBusy={onlineGameBusy}
            pulseTick={pulseTicks.debatePanel}
          />
        ) : isShowdownVoting ? (
          <ShowdownVotingPanel
            judge={judge}
            judgeWord={judgeWord}
            contenders={contenders}
            defaultPlayerVotes={defaultPlayerVotes}
            effectivePlayerVotes={effectivePlayerVotes}
            setPlayerVotes={setPlayerVotes}
            effectiveJudgeVote={effectiveJudgeVote}
            setJudgeVote={setJudgeVote}
            similarityRows={similarityRows}
            canResolveVotes={canResolveVotes}
            onResolveVotes={resolveVotes}
            pulseTick={pulseTicks.showdownPanel}
            isOnlinePlaying={isOnlinePlaying}
            myPlayerId={myOnlineSeatIndex}
            submittedPlayerVoteIds={onlineSubmittedPlayerVoteIds}
            submittedPlayerVoteCount={submittedPlayerVoteCount}
            judgeVoteSubmitted={judgeVoteSubmitted}
            usesJudgeVote={Boolean(judge)}
            onlineGameBusy={onlineGameBusy}
            onlinePlayerVoteValue={onlinePlayerVoteValue}
            setOnlinePlayerVoteValue={(nextValue) => {
              setPlayerVotes((previous) => ({
                ...previous,
                [myOnlineSeatIndex]: nextValue,
              }))
            }}
            onSubmitOnlinePlayerVote={submitOnlinePlayerVote}
            onlineJudgeVoteValue={onlineJudgeVoteValue}
            setOnlineJudgeVoteValue={setJudgeVote}
            onSubmitOnlineJudgeVote={submitOnlineJudgeVote}
          />
        ) : (
          <TurnPanel
            actor={actor}
            legal={legal}
            amountInput={amountInput}
            setAmountInput={setAmountInput}
            onRunAction={(type, amountOverride) => {
              if (isOnlinePlaying && !isMyTurnOnline) {
                setErrorText(TURN_WAIT_ERROR)
                return
              }

              runAction(type, amountOverride)
            }}
            pulseTick={pulseTicks.turnPanel}
          />
        )}

        {visibleErrorText ? <p className="error-text">{visibleErrorText}</p> : null}
      </section>

      <ActionLogPanel log={game.log} />
    </main>
  )
}

export default App
