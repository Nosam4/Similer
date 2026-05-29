import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import {
  applyPlayerAction,
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
import HandCompletePanel from './components/HandCompletePanel'
import JudgeRow from './components/JudgeRow'
import OnlineRoomPanel from './components/OnlineRoomPanel'
import PlayersGrid from './components/PlayersGrid'
import ShowdownVotingPanel from './components/ShowdownVotingPanel'
import StatusRow from './components/StatusRow'
import TableHeader from './components/TableHeader'
import TurnPanel from './components/TurnPanel'
import { saveRoomState, setRoomStatus } from './multiplayer/roomApi'

const PLAYER_NAMES = ['North', 'East', 'South', 'West']
const INITIAL_PULSE_TICKS = {
  phaseTile: 0,
  judgeRow: 0,
  showdownPanel: 0,
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

function App() {
  const [localGame, setLocalGame] = useState(() => {
    return createInitialGame({
      playerNames: PLAYER_NAMES,
      startingStack: 400,
      smallBlind: 5,
      bigBlind: 10,
    })
  })
  const [amountInput, setAmountInput] = useState('')
  const [errorText, setErrorText] = useState('')
  const [revealByPlayerId, setRevealByPlayerId] = useState({})
  const [playerVotes, setPlayerVotes] = useState({})
  const [judgeVote, setJudgeVote] = useState('')
  const [onlineSession, setOnlineSession] = useState(null)
  const [onlineGameBusy, setOnlineGameBusy] = useState(false)
  const [pulseTicks, setPulseTicks] = useState(INITIAL_PULSE_TICKS)
  const previousPhaseRef = useRef(null)

  const onlineGame = useMemo(() => {
    const candidate = onlineSession?.roomState?.state_json
    return isWordGameState(candidate) ? candidate : null
  }, [onlineSession?.roomState?.state_json])

  const isOnlinePlaying = Boolean(onlineSession?.room?.status === 'playing' && onlineGame)
  const game = isOnlinePlaying ? onlineGame : localGame

  const actor = getCurrentActor(game)
  const legal = getLegalActions(game)
  const potSummary = getPotSummary(game)
  const judge = getJudgePlayer(game)
  const contenders = getContenders(game)

  const isShowdownVoting = game.phase === 'showdownVoting'

  const similarityRows = useMemo(() => {
    if (!judge || !isShowdownVoting) {
      return []
    }

    return contenders.map((player) => {
      return {
        playerId: player.id,
        playerName: player.name,
        playerWord: player.holeWord,
        similarity: getSimilarityForWords(player.holeWord, judge.holeWord),
      }
    })
  }, [contenders, isShowdownVoting, judge])

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
    Object.keys(playerVotes).length > 0 ? playerVotes : defaultPlayerVotes
  const effectiveJudgeVote =
    judgeVote || (contenders.length > 0 ? String(contenders[0].id) : '')

  const canResolveVotes =
    isShowdownVoting &&
    contenders.length > 1 &&
    judge &&
    contenders.every((voter) => {
      const value = effectivePlayerVotes[voter.id]
      return value !== undefined && value !== ''
    }) &&
    effectiveJudgeVote !== ''

  const myOnlineSeatIndex = onlineSession?.myPlayer?.seat_index ?? null
  const roomId = onlineSession?.room?.id ?? null
  const roomStateVersion = onlineSession?.roomState?.version ?? null
  const userId = onlineSession?.userId ?? null

  const persistOnlineGame = useCallback(
    async (nextGame, nextStatus = null) => {
      if (!roomId || !userId) {
        throw new Error('No active room is connected.')
      }

      const savedRoomState = await saveRoomState({
        roomId,
        nextState: nextGame,
        updatedByUserId: userId,
        expectedVersion: roomStateVersion,
      })

      if (nextStatus) {
        await setRoomStatus({
          roomId,
          hostUserId: onlineSession?.room?.host_user_id,
          status: nextStatus,
        })
      }

      setOnlineSession((previous) => {
        if (!previous) {
          return previous
        }

        return {
          ...previous,
          roomState: savedRoomState,
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
        await persistOnlineGame(nextGame)
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
        await persistOnlineGame(nextGame)
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

  async function resolveVotes() {
    try {
      const nextGame = resolveShowdownVotes(game, {
        playerVotes: effectivePlayerVotes,
        judgeVote: Number(effectiveJudgeVote),
      })
      if (isOnlinePlaying) {
        setOnlineGameBusy(true)
        await persistOnlineGame(nextGame)
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
      const initialSharedGame = createInitialGame({
        playerNames: PLAYER_NAMES,
        startingStack: 400,
        smallBlind: 5,
        bigBlind: 10,
      })

      const savedRoomState = await saveRoomState({
        roomId: onlineSession.room.id,
        nextState: initialSharedGame,
        updatedByUserId: userId,
        expectedVersion: onlineSession.roomState?.version ?? null,
      })

      await setRoomStatus({
        roomId: onlineSession.room.id,
        hostUserId: userId,
        status: 'playing',
      })

      setOnlineSession((previous) => {
        if (!previous) {
          return previous
        }

        return {
          ...previous,
          roomState: savedRoomState,
          room: {
            ...previous.room,
            status: 'playing',
          },
        }
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

  const isMyTurnOnline = isOnlinePlaying && actor && actor.id === myOnlineSeatIndex
  const effectiveRevealByPlayerId = useMemo(() => {
    if (!isOnlinePlaying || myOnlineSeatIndex === null) {
      return revealByPlayerId
    }

    return {
      ...revealByPlayerId,
      [myOnlineSeatIndex]: true,
    }
  }, [isOnlinePlaying, myOnlineSeatIndex, revealByPlayerId])

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

      <JudgeRow judge={judge} pulseTick={pulseTicks.judgeRow} />

      <PlayersGrid
        players={game.players}
        dealerIndex={game.dealerIndex}
        currentPlayerIndex={game.currentPlayerIndex}
        phase={game.phase}
        handComplete={game.handComplete}
        revealByPlayerId={effectiveRevealByPlayerId}
        onToggleWordReveal={toggleWordReveal}
      />

      <section className="controls">
        {game.tableComplete ? (
          <div className="notice">
            <p>Table over: only one player has chips remaining.</p>
          </div>
        ) : null}

        {game.handComplete ? (
          <HandCompletePanel
            game={game}
            onBeginNextHand={beginNextHand}
            pulseTick={pulseTicks.handPanel}
            winnerPulseTick={pulseTicks.winnerLine}
          />
        ) : isShowdownVoting ? (
          <ShowdownVotingPanel
            judge={judge}
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
          />
        ) : (
          <TurnPanel
            actor={actor}
            legal={legal}
            amountInput={amountInput}
            setAmountInput={setAmountInput}
            onRunAction={(type, amountOverride) => {
              if (isOnlinePlaying && !isMyTurnOnline) {
                setErrorText('It is not your turn yet.')
                return
              }

              runAction(type, amountOverride)
            }}
            pulseTick={pulseTicks.turnPanel}
          />
        )}

        {errorText ? <p className="error-text">{errorText}</p> : null}
      </section>

      <ActionLogPanel log={game.log} />
    </main>
  )
}

export default App
