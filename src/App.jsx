import { useEffect, useMemo, useRef, useState } from 'react'
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

const PLAYER_NAMES = ['North', 'East', 'South', 'West']
const INITIAL_PULSE_TICKS = {
  phaseTile: 0,
  judgeRow: 0,
  showdownPanel: 0,
  turnPanel: 0,
  handPanel: 0,
  winnerLine: 0,
}

function App() {
  const [game, setGame] = useState(() => {
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
  const [pulseTicks, setPulseTicks] = useState(INITIAL_PULSE_TICKS)
  const previousPhaseRef = useRef(game.phase)

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

  useEffect(() => {
    const previousPhase = previousPhaseRef.current

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

  function runAction(type, amountOverride) {
    try {
      const nextGame = applyPlayerAction(
        game,
        type,
        amountOverride ?? Number(amountInput),
      )
      setGame(nextGame)
      setErrorText('')

      const nextLegal = getLegalActions(nextGame)
      if (nextLegal.raise) {
        setAmountInput(String(nextLegal.minRaiseTo))
      } else if (nextLegal.bet) {
        setAmountInput(String(nextLegal.minBetTo))
      }
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Action failed.')
    }
  }

  function beginNextHand() {
    const nextGame = startNextHand(game)
    setGame(nextGame)
    setErrorText('')
    setAmountInput('')
    setPlayerVotes({})
    setJudgeVote('')
    setRevealByPlayerId({})
  }

  function resolveVotes() {
    try {
      const nextGame = resolveShowdownVotes(game, {
        playerVotes: effectivePlayerVotes,
        judgeVote: Number(effectiveJudgeVote),
      })
      setGame(nextGame)
      setErrorText('')
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Vote resolution failed.')
    }
  }

  function toggleWordReveal(playerId) {
    setRevealByPlayerId((previous) => {
      return {
        ...previous,
        [playerId]: !previous[playerId],
      }
    })
  }

  return (
    <main className="table-shell">
      <OnlineRoomPanel />

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
        revealByPlayerId={revealByPlayerId}
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
            onRunAction={runAction}
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
