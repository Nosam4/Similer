import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import {
  createInitialGame,
  getArgumentProgress,
  getContenders,
  getCurrentActor,
  getJudgePlayer,
  getLegalActions,
  getPhaseLabel,
  getPlayerVoteVoters,
  getPotSummary,
  getWordBankSize,
} from './wordgame/engine'
import { DEFAULT_WORD_PACK_ID, WORD_PACKS, getWordPackById } from './wordgame/wordPacks'
import ActionLogPanel from './components/ActionLogPanel'
import ConfettiComponent from './components/ConfettiComponent'
import LocalGameViewport from './components/LocalGameViewport'
import LocalTestControls from './components/LocalTestControls'
import OnlineRoomPanel from './components/OnlineRoomPanel'
import PokerTable from './components/PokerTable'
import ArgumentStageOverlay from './components/game/ArgumentStageOverlay'
import GameActionPanel from './components/game/GameActionPanel'
import {
  buildSubmittedPlayerVoteIds,
  hasSubmittedJudgeVote,
} from './multiplayer/privateGameState'
import { useGameActions } from './game/useGameActions'
import { useOnlineGameState } from './game/useOnlineGameState'

const PLAYER_NAMES = ['North', 'East', 'South', 'West']
const STARTING_STACK = 400
const ANTE = 10
const MIN_BET = 10
const TURN_WAIT_ERROR = 'It is not your turn yet.'
const DEFAULT_LOCAL_WORD_PACK = getWordPackById(DEFAULT_WORD_PACK_ID)
const INITIAL_PULSE_TICKS = {
  phaseTile: 0,
  judgeRow: 0,
  showdownPanel: 0,
  debatePanel: 0,
  turnPanel: 0,
  handPanel: 0,
  winnerLine: 0,
}

function getLocalArgumentMarkPlayerId(progress, actor = null) {
  const requiredPlayerIds = progress?.requiredPlayerIds ?? []

  if (actor && requiredPlayerIds.includes(actor.id)) {
    return actor.id
  }

  return requiredPlayerIds[0] ?? null
}

function App() {
  const [localGame, setLocalGame] = useState(() => {
    return createInitialGame({
      playerNames: PLAYER_NAMES,
      startingStack: STARTING_STACK,
      ante: ANTE,
      bigBlind: MIN_BET,
      wordPack: DEFAULT_LOCAL_WORD_PACK,
    })
  })
  const [localWordPackId, setLocalWordPackId] = useState(DEFAULT_WORD_PACK_ID)
  const [amountInput, setAmountInput] = useState('')
  const [errorText, setErrorText] = useState('')
  const [revealByPlayerId, setRevealByPlayerId] = useState({})
  const [playerVotes, setPlayerVotes] = useState({})
  const [judgeVote, setJudgeVote] = useState('')
  const [pulseTicks, setPulseTicks] = useState(INITIAL_PULSE_TICKS)
  const previousPhaseRef = useRef(null)
  const {
    activeOnlineVoteStatusRows,
    applyOnlineCommandResult,
    handleOnlineSessionChange,
    handlePrivateDataChange,
    hydratedOnlineGame,
    isOnlinePlaying,
    isOnlineRoomConnected,
    isOnlineWaiting,
    myOnlineSeatIndex,
    onlineGameBusy,
    onlineSession,
    onlineWaitingCopy,
    roomId,
    setOnlineGameBusy,
    setOnlinePrivateDataKey,
    setOnlineVoteStatusRows,
    userId,
  } = useOnlineGameState({ setErrorText })
  const localWordPack = useMemo(() => getWordPackById(localWordPackId), [localWordPackId])

  const game = isOnlinePlaying ? hydratedOnlineGame : localGame
  const openingArgumentProgress = useMemo(() => {
    return getArgumentProgress(game, 'opening')
  }, [game])
  const closingArgumentProgress = useMemo(() => {
    return getArgumentProgress(game, 'closing')
  }, [game])

  useEffect(() => {
    document.body.classList.add('local-game-active')

    return () => {
      document.body.classList.remove('local-game-active')
    }
  }, [])

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
  const canForceCompleteArguments = !isOnlinePlaying || isOnlineHost
  const openingArgumentMarkPlayerId = isOnlinePlaying
    ? myOnlineSeatIndex
    : getLocalArgumentMarkPlayerId(openingArgumentProgress, actor)
  const closingArgumentMarkPlayerId = isOnlinePlaying
    ? myOnlineSeatIndex
    : getLocalArgumentMarkPlayerId(closingArgumentProgress)
  const isMyTurnOnline = isOnlinePlaying && actor && actor.id === myOnlineSeatIndex
  const onlinePlayerVoteValue =
    myOnlineSeatIndex === null ? '' : playerVotes[myOnlineSeatIndex] ?? ''
  const onlineJudgeVoteValue = judgeVote
  const {
    beginNextHand,
    forceCompleteArgumentPhase,
    handleSelectLocalWordPack,
    handleStartOnlineGame,
    markArgument,
    resolveVotes,
    restartLocalTestGame,
    runAction,
    startNewGame,
    submitOnlineJudgeVote,
    submitOnlinePlayerVote,
  } = useGameActions({
    amountInput,
    ante: ANTE,
    applyOnlineCommandResult,
    bigBlind: MIN_BET,
    canResolveVotes,
    contenders,
    effectiveJudgeVote,
    effectivePlayerVotes,
    game,
    initialPulseTicks: INITIAL_PULSE_TICKS,
    isOnlinePlaying,
    isShowdownVoting,
    judge,
    localGame,
    localWordPack,
    myOnlineSeatIndex,
    onlineJudgeVoteValue,
    onlinePlayerVoteValue,
    onlineSession,
    playerVoteVoters,
    previousPhaseRef,
    roomId,
    setAmountInput,
    setErrorText,
    setJudgeVote,
    setLocalGame,
    setLocalWordPackId,
    setOnlineGameBusy,
    setOnlinePrivateDataKey,
    setOnlineVoteStatusRows,
    setPlayerVotes,
    setPulseTicks,
    setRevealByPlayerId,
    startingStack: STARTING_STACK,
    userId,
  })
  const effectiveRevealByPlayerId = useMemo(() => {
    if (!isOnlinePlaying || myOnlineSeatIndex === null) {
      return revealByPlayerId
    }

    return {
      ...revealByPlayerId,
      [myOnlineSeatIndex]: Boolean(revealByPlayerId[myOnlineSeatIndex]),
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
  const isOpeningArgumentGate =
    isJudgeWordLive &&
    !openingArgumentProgress.complete &&
    openingArgumentProgress.speakers.length > 0

  function toggleWordReveal(playerId) {
    if (isOnlinePlaying && myOnlineSeatIndex !== null && playerId !== myOnlineSeatIndex) {
      return
    }

    setRevealByPlayerId((previous) => {
      const currentlyVisible = Boolean(previous[playerId])

      return {
        ...previous,
        [playerId]: !currentlyVisible,
      }
    })
  }

  const viewportEyebrow = isOnlinePlaying
    ? 'Online Table'
    : isOnlineRoomConnected
      ? 'Online Setup'
      : 'Local Table'
  const viewportStageOverlay = (
    <ArgumentStageOverlay
      busy={isOnlinePlaying ? onlineGameBusy : false}
      canForceCompleteArguments={canForceCompleteArguments}
      closingArgumentMarkPlayerId={closingArgumentMarkPlayerId}
      closingArgumentProgress={closingArgumentProgress}
      errorText={visibleErrorText}
      game={game}
      isDebate={isDebate}
      isJudgeWordLive={isJudgeWordLive}
      judge={judge}
      judgeWord={judgeWord}
      openingArgumentMarkPlayerId={openingArgumentMarkPlayerId}
      openingArgumentProgress={openingArgumentProgress}
      onMarkArgument={markArgument}
      onForceComplete={forceCompleteArgumentPhase}
    />
  )
  const viewportTable = (
    <PokerTable
      players={game.players}
      dealerIndex={game.dealerIndex}
      currentPlayerIndex={game.currentPlayerIndex}
      phase={game.phase}
      phaseLabel={getPhaseLabel(game.phase)}
      handNumber={game.handNumber}
      potSummary={potSummary}
      judge={judge}
      judgeWord={judgeWord}
      wordBankSize={getWordBankSize(game)}
      phasePulseTick={pulseTicks.phaseTile}
      handComplete={game.handComplete}
      revealByPlayerId={effectiveRevealByPlayerId}
      onToggleWordReveal={toggleWordReveal}
      showWordControls
      wordControlPlayerId={isOnlinePlaying ? myOnlineSeatIndex : null}
      viewerPlayerId={isOnlinePlaying ? myOnlineSeatIndex : null}
      delayJudgeTransfer={isOpeningArgumentGate}
    />
  )
  const localSetupPanel = !isOnlineRoomConnected ? (
    <LocalTestControls
      playerCount={localGame.players.length}
      onSelectPlayerCount={restartLocalTestGame}
      wordPacks={WORD_PACKS}
      selectedWordPackId={localWordPackId}
      onSelectWordPack={handleSelectLocalWordPack}
    />
  ) : null
  const viewportActionPanel = (
    <GameActionPanel
      actor={actor}
      amountInput={amountInput}
      canResolveVotes={canResolveVotes}
      contenders={contenders}
      defaultPlayerVotes={defaultPlayerVotes}
      effectiveJudgeVote={effectiveJudgeVote}
      effectivePlayerVotes={effectivePlayerVotes}
      game={game}
      isBustedOnline={isBustedOnline}
      isDebate={isDebate}
      isFinalDuel={isFinalDuel}
      isMyTurnOnline={isMyTurnOnline}
      isNeutralVoting={isNeutralVoting}
      isOnlineHost={isOnlineHost}
      isOnlinePlaying={isOnlinePlaying}
      isOnlineWaiting={isOnlineWaiting}
      isShowdownVoting={isShowdownVoting}
      judge={judge}
      judgeVoteSubmitted={judgeVoteSubmitted}
      judgeWord={judgeWord}
      legal={legal}
      myOnlinePlayer={myOnlinePlayer}
      myOnlineSeatIndex={myOnlineSeatIndex}
      onBeginNextHand={beginNextHand}
      onResolveVotes={resolveVotes}
      onRunAction={runAction}
      onStartNewGame={startNewGame}
      onSubmitOnlineJudgeVote={submitOnlineJudgeVote}
      onSubmitOnlinePlayerVote={submitOnlinePlayerVote}
      onTurnWait={() => setErrorText(TURN_WAIT_ERROR)}
      onlineGameBusy={onlineGameBusy}
      onlineJudgeVoteValue={onlineJudgeVoteValue}
      onlinePlayerVoteValue={onlinePlayerVoteValue}
      onlineSubmittedPlayerVoteIds={onlineSubmittedPlayerVoteIds}
      onlineWaitingCopy={onlineWaitingCopy}
      playerVoteVoters={playerVoteVoters}
      potSummary={potSummary}
      pulseTicks={pulseTicks}
      setAmountInput={setAmountInput}
      setJudgeVote={setJudgeVote}
      setPlayerVotes={setPlayerVotes}
      submittedPlayerVoteCount={submittedPlayerVoteCount}
      visibleErrorText={visibleErrorText}
    />
  )

  return (
    <LocalGameViewport
      confetti={<ConfettiComponent key={confettiKey} active={confettiActive} mode={confettiMode} />}
      stageOverlay={viewportStageOverlay}
      eyebrow={viewportEyebrow}
      headerPanel={
        <OnlineRoomPanel
          variant="header"
          initialSession={onlineSession}
          onSessionChange={handleOnlineSessionChange}
          onStartOnlineGame={handleStartOnlineGame}
          onPrivateDataChange={handlePrivateDataChange}
          onlineGameBusy={onlineGameBusy}
        />
      }
      setupPanel={localSetupPanel}
      table={viewportTable}
      actionPanel={viewportActionPanel}
      logPanel={<ActionLogPanel log={game.log} />}
    />
  )
}

export default App
