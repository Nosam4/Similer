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
  getPlayerVoteVoters,
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
import OnlineRoomPanel from './components/OnlineRoomPanel'
import PokerTable from './components/PokerTable'
import ShowdownVotingPanel from './components/ShowdownVotingPanel'
import StageOverlay from './components/StageOverlay'
import TableHeader from './components/TableHeader'
import TurnPanel from './components/TurnPanel'
import {
  fetchAccessibleHandWords,
  fetchShowdownVoteStatuses,
  invokeGameCommand,
  submitShowdownVote,
} from './multiplayer/roomApi'
import {
  buildSubmittedPlayerVoteIds,
  buildWordMap,
  hasSubmittedJudgeVote,
  hydrateGameWithWords,
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
  const [onlinePrivateRefreshTick, setOnlinePrivateRefreshTick] = useState(0)
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

  const isOnlineRoomConnected = Boolean(onlineSession?.room)
  const isOnlinePlaying = Boolean(onlineSession?.room?.status === 'playing' && hydratedOnlineGame)
  const shouldShowGameTable = !isOnlineRoomConnected || isOnlinePlaying
  const onlineWaitingCopy =
    onlineSession?.room?.status === 'playing'
      ? 'Loading the online game state. Players should wait here while the room syncs.'
      : 'Online room is waiting. Mark ready, wait for seats to fill, and start the online game from the room controls.'
  const game = isOnlinePlaying ? hydratedOnlineGame : localGame

  const actor = getCurrentActor(game)
  const legal = getLegalActions(game)
  const potSummary = getPotSummary(game)
  const judge = getJudgePlayer(game)
  const contenders = getContenders(game)
  const playerVoteVoters = getPlayerVoteVoters(game)

  const isShowdownVoting = game.phase === 'showdownVoting'
  const isDebate = game.phase === 'debate'
  const judgeWord = game.judgeWord ?? judge?.holeWord ?? null
  const isJudgeWordLive = game.phase === 'postflop' && Boolean(judgeWord)
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

    for (const voter of playerVoteVoters) {
      const fallback = contenders.find((candidate) => candidate.id !== voter.id) ?? contenders[0]
      defaults[voter.id] = String(fallback.id)
    }

    return defaults
  }, [contenders, isShowdownVoting, playerVoteVoters])

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
    ? playerVoteVoters.filter((voter) => onlineSubmittedPlayerVoteIds.includes(voter.id))
        .length
    : playerVoteVoters.filter((voter) => {
        const value = effectivePlayerVotes[voter.id]
        const targetId = Number(value)

        return (
          value !== undefined &&
          value !== '' &&
          (!contenders.some((contender) => contender.id === voter.id) ||
            targetId !== voter.id) &&
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
      ? submittedPlayerVoteCount === playerVoteVoters.length && judgeVoteSubmitted
      : playerVoteVoters.every((voter) => {
          const value = effectivePlayerVotes[voter.id]
          const targetId = Number(value)

          return (
            value !== undefined &&
            value !== '' &&
            (!contenders.some((contender) => contender.id === voter.id) ||
              targetId !== voter.id) &&
            contenders.some((target) => target.id === targetId)
          )
        }) &&
        (!judge || effectiveJudgeVote !== ''))

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
      if (isOnlinePlaying) {
        setOnlineGameBusy(true)
        const result = await invokeGameCommand({
          roomId,
          command: 'playerAction',
          payload: {
            type,
            amount: amountOverride ?? Number(amountInput),
          },
        })
        applyOnlineCommandResult(result)

        const nextLegal = getLegalActions(result.roomState.state_json)
        if (nextLegal.raise) {
          setAmountInput(String(nextLegal.minRaiseTo))
        } else if (nextLegal.bet) {
          setAmountInput(String(nextLegal.minBetTo))
        }
      } else {
        const nextGame = applyPlayerAction(
          game,
          type,
          amountOverride ?? Number(amountInput),
        )
        setLocalGame(nextGame)

        const nextLegal = getLegalActions(nextGame)
        if (nextLegal.raise) {
          setAmountInput(String(nextLegal.minRaiseTo))
        } else if (nextLegal.bet) {
          setAmountInput(String(nextLegal.minBetTo))
        }
      }
      setErrorText('')
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Action failed.')
    } finally {
      setOnlineGameBusy(false)
    }
  }

  async function beginNextHand() {
    try {
      if (isOnlinePlaying) {
        setOnlineGameBusy(true)
        const result = await invokeGameCommand({
          roomId,
          command: 'startNextHand',
        })
        applyOnlineCommandResult(result)
      } else {
        const nextGame = startNextHand(game)
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
    try {
      if (isOnlinePlaying) {
        setOnlineGameBusy(true)
        const result = await invokeGameCommand({
          roomId,
          command: 'startNewGame',
          payload: {
            startingStack: STARTING_STACK,
            smallBlind: SMALL_BLIND,
            bigBlind: BIG_BLIND,
          },
        })
        applyOnlineCommandResult(result)
      } else {
        const nextGame = createInitialGame({
          playerNames: getRestartPlayerNames(game, onlineSession),
          startingStack: STARTING_STACK,
          smallBlind: SMALL_BLIND,
          bigBlind: BIG_BLIND,
        })
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

      if (isOnlinePlaying) {
        setOnlineGameBusy(true)
        const result = await invokeGameCommand({
          roomId,
          command: 'resolveVotes',
        })
        applyOnlineCommandResult(result)
      } else {
        const nextGame = resolveShowdownVotes(game, {
          playerVotes: effectivePlayerVotes,
          judgeVote: judge ? Number(effectiveJudgeVote) : null,
        })
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
      if (isOnlinePlaying) {
        setOnlineGameBusy(true)
        const result = await invokeGameCommand({
          roomId,
          command: 'completeDebate',
        })
        applyOnlineCommandResult(result)
      } else {
        const nextGame = completeDebateStage(game)
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

    const voter = playerVoteVoters.find((player) => player.id === voterId)

    if (!voter) {
      setErrorText('The Judge does not submit a Player Vote.')
      return
    }

    if (!contenders.some((player) => player.id === targetId)) {
      setErrorText('Choose a valid player vote before submitting.')
      return
    }

    if (contenders.some((player) => player.id === voterId) && targetId === voterId) {
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
  const handlePrivateDataChange = useCallback(() => {
    setOnlinePrivateRefreshTick((previous) => previous + 1)
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
      const result = await invokeGameCommand({
        roomId,
        command: 'startGame',
        payload: {
          startingStack: STARTING_STACK,
          smallBlind: SMALL_BLIND,
          bigBlind: BIG_BLIND,
        },
      })
      applyOnlineCommandResult(result)

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
  const isOnlineHost = Boolean(isOnlinePlaying && onlineSession?.room?.host_user_id === userId)
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
  const stageOverlayConfig = isJudgeWordLive
    ? {
        activeKey: `judge-word-live-${game.handNumber}-${judge?.id ?? 'neutral'}-${judgeWord}`,
        kicker: 'Word Revealed',
        title: 'JUDGE WORD LIVE',
        wordLabel: judge ? `${judge.name} reveals` : 'Judge word',
        message: judge
          ? 'Make your next bet with the word in mind.'
          : 'Betting continues with the word revealed.',
      }
    : isDebate
      ? {
          activeKey: `debate-${game.handNumber}`,
          title: 'DEBATE STAGE',
          judgeWord,
        }
      : null

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
      <StageOverlay
        activeKey={stageOverlayConfig?.activeKey ?? ''}
        kicker={stageOverlayConfig?.kicker}
        title={stageOverlayConfig?.title}
        judgeWord={judgeWord}
        wordLabel={stageOverlayConfig?.wordLabel}
        message={stageOverlayConfig?.message}
      />

      <OnlineRoomPanel
        onSessionChange={handleOnlineSessionChange}
        onStartOnlineGame={handleStartOnlineGame}
        onPrivateDataChange={handlePrivateDataChange}
        onlineGameBusy={onlineGameBusy}
      />

      {!shouldShowGameTable ? (
        <section className="controls">
          <div className="notice">
            <p>{onlineWaitingCopy}</p>
          </div>

          {visibleErrorText ? <p className="error-text">{visibleErrorText}</p> : null}
        </section>
      ) : (
        <>
      <TableHeader />

      <PokerTable
        players={game.players}
        dealerIndex={game.dealerIndex}
        smallBlindIndex={game.smallBlindIndex}
        bigBlindIndex={game.bigBlindIndex}
        currentPlayerIndex={game.currentPlayerIndex}
        phase={game.phase}
        phaseLabel={getPhaseLabel(game.phase)}
        handNumber={game.handNumber}
        potSummary={potSummary}
        judge={judge}
        judgeWord={judgeWord}
        wordBankSize={getWordBankSize()}
        phasePulseTick={pulseTicks.phaseTile}
        handComplete={game.handComplete}
        revealByPlayerId={effectiveRevealByPlayerId}
        onToggleWordReveal={toggleWordReveal}
        showWordControls={!isOnlinePlaying}
        viewerPlayerId={isOnlinePlaying ? myOnlineSeatIndex : null}
      />

      <section className="controls">
        {game.tableComplete ? (
          <div className="notice">
            <p>Table over: only one player has chips remaining.</p>
          </div>
        ) : null}

        {isBustedOnline && !game.handComplete && !isDebate && !isShowdownVoting ? (
          <BustedPanel playerName={myOnlinePlayer?.name} />
        ) : game.handComplete ? (
          <HandCompletePanel
            game={game}
            onBeginNextHand={beginNextHand}
            onStartNewGame={startNewGame}
            actionDisabled={onlineGameBusy || (isOnlinePlaying && !isOnlineHost)}
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
            playerVoteVoters={playerVoteVoters}
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
            potSummary={potSummary}
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
        </>
      )}
    </main>
  )
}

export default App
