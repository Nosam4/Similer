import { useLayoutEffect, useRef, useState } from 'react'
import { gsap } from 'gsap'
import { summarizePlayerStatus } from './uiHelpers'

const SEAT_LAYOUTS = {
  1: [{ x: 50, y: 86 }],
  2: [
    { x: 50, y: 86 },
    { x: 50, y: 22 },
  ],
  3: [
    { x: 50, y: 86 },
    { x: 18, y: 42 },
    { x: 82, y: 42 },
  ],
  4: [
    { x: 50, y: 86 },
    { x: 16, y: 54 },
    { x: 50, y: 22 },
    { x: 84, y: 54 },
  ],
  5: [
    { x: 50, y: 86 },
    { x: 18, y: 66 },
    { x: 26, y: 24 },
    { x: 74, y: 24 },
    { x: 82, y: 66 },
  ],
  6: [
    { x: 50, y: 86 },
    { x: 18, y: 70 },
    { x: 18, y: 34 },
    { x: 50, y: 22 },
    { x: 82, y: 34 },
    { x: 82, y: 70 },
  ],
  7: [
    { x: 50, y: 86 },
    { x: 20, y: 76 },
    { x: 12, y: 48 },
    { x: 32, y: 22 },
    { x: 68, y: 22 },
    { x: 88, y: 48 },
    { x: 80, y: 76 },
  ],
  8: [
    { x: 50, y: 86 },
    { x: 24, y: 78 },
    { x: 12, y: 52 },
    { x: 24, y: 26 },
    { x: 50, y: 20 },
    { x: 76, y: 26 },
    { x: 88, y: 52 },
    { x: 76, y: 78 },
  ],
}

function getSeatLayout(playerCount) {
  return SEAT_LAYOUTS[playerCount] ?? SEAT_LAYOUTS[8]
}

function getPlayerIdAtIndex(players, index) {
  if (index === null || index === undefined) {
    return null
  }

  return players[index]?.id ?? null
}

function rotatePlayersForViewer(players, viewerPlayerId) {
  const viewerIndex = players.findIndex((player) => player.id === viewerPlayerId)

  if (viewerIndex <= 0) {
    return players
  }

  return [...players.slice(viewerIndex), ...players.slice(0, viewerIndex)]
}

function EyeIcon({ isHidden }) {
  if (isHidden) {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 3l18 18" />
        <path d="M10.7 10.7a2 2 0 002.6 2.6" />
        <path d="M8.3 5.4A9.8 9.8 0 0112 4c5 0 8.5 4.2 10 8a13.3 13.3 0 01-3.1 4.4" />
        <path d="M6.2 6.8A13.2 13.2 0 002 12c1.5 3.8 5 8 10 8a9.7 9.7 0 004.4-1.1" />
      </svg>
    )
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M2 12s3.5-8 10-8 10 8 10 8-3.5 8-10 8S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

function getWordText(player, isWordVisible) {
  if (!player.inHand && !player.holeWord) {
    return '--'
  }

  if (isWordVisible && player.holeWord) {
    return player.holeWord
  }

  return '••••••'
}

function PokerTable({
  players,
  dealerIndex,
  currentPlayerIndex,
  phase,
  phaseLabel,
  handNumber,
  potSummary,
  judge,
  judgeWord = null,
  wordBankSize,
  phasePulseTick = 0,
  handComplete,
  revealByPlayerId,
  onToggleWordReveal,
  showWordControls = true,
  wordControlPlayerId = null,
  viewerPlayerId = null,
  delayJudgeTransfer = false,
}) {
  const judgeWordFlightRef = useRef(null)
  const judgeNameFlightRef = useRef(null)
  const transferDelayRef = useRef(null)
  const [settledTransferKey, setSettledTransferKey] = useState('')
  const dealerPlayerId = getPlayerIdAtIndex(players, dealerIndex)
  const currentPlayerId = getPlayerIdAtIndex(players, currentPlayerIndex)
  const judgeId = judge?.id ?? null
  const judgeTransferKey = judgeId === null ? '' : `${handNumber}:${judgeId}`
  const centerJudgeWord = judge?.holeWord ?? judgeWord
  const isJudgeTransferPending = Boolean(
    judge && centerJudgeWord && judgeTransferKey && settledTransferKey !== judgeTransferKey,
  )
  const isJudgeTransferDelayed = Boolean(isJudgeTransferPending && delayJudgeTransfer)
  const shouldRunJudgeTransfer = Boolean(isJudgeTransferPending && !isJudgeTransferDelayed)
  const fullVisualPlayers = rotatePlayersForViewer(players, viewerPlayerId)
  const fullLayout = getSeatLayout(fullVisualPlayers.length)
  const visualSeats = fullVisualPlayers
    .map((player, index) => ({
      player,
      position: fullLayout[index] ?? fullLayout[fullLayout.length - 1],
    }))
    .filter(({ player }) => isJudgeTransferDelayed || player.id !== judge?.id)
  const judgeFlightIndex = fullVisualPlayers.findIndex((player) => player.id === judge?.id)
  const judgeFlightPosition =
    judgeFlightIndex >= 0 ? fullLayout[judgeFlightIndex] ?? fullLayout[fullLayout.length - 1] : null
  const shouldShowJudgeCenter = Boolean(centerJudgeWord && (!judge || !isJudgeTransferPending))
  const centerCopy = judge
    ? `${judge.name}${dealerPlayerId === judge.id ? ' · Dealer' : ''}`
    : judgeWord
      ? 'Neutral judge word'
      : 'Judge word revealed after opening statements'

  useLayoutEffect(() => {
    if (!shouldRunJudgeTransfer || !judgeWordFlightRef.current || !judgeNameFlightRef.current) {
      return undefined
    }

    const wordToken = judgeWordFlightRef.current
    const nameToken = judgeNameFlightRef.current
    const timeline = gsap.timeline({
      paused: true,
      defaults: { ease: 'power3.inOut' },
      onComplete: () => {
        setSettledTransferKey(judgeTransferKey)
      },
    })

    gsap.set(wordToken, {
      autoAlpha: 0,
      scale: 0.86,
      xPercent: -50,
      y: -12,
      yPercent: -50,
      transformOrigin: '50% 50%',
    })
    gsap.set(nameToken, {
      autoAlpha: 0,
      scale: 0.86,
      xPercent: -50,
      y: 18,
      yPercent: -50,
      transformOrigin: '50% 50%',
    })
    timeline
      .set([wordToken, nameToken], { autoAlpha: 1 })
      .to(wordToken, {
        left: '50%',
        top: '44%',
        y: 0,
        scale: 1,
        duration: 1.05,
      }, 0)
      .to(nameToken, {
        left: '50%',
        top: '57%',
        y: 0,
        scale: 1,
        duration: 1.05,
      }, 0.08)
      .to([wordToken, nameToken], { scale: 1.03, duration: 0.16, ease: 'power2.out' }, '>')
      .to([wordToken, nameToken], { autoAlpha: 0, duration: 0.18 }, '+=0.05')

    transferDelayRef.current = window.setTimeout(() => {
      timeline.paused(false)
    }, 120)

    return () => {
      window.clearTimeout(transferDelayRef.current)
      timeline.kill()
    }
  }, [judgeTransferKey, shouldRunJudgeTransfer])

  return (
    <section className="poker-table-shell" aria-label="Similer table">
      <div className="poker-table-meta" aria-label="Round summary">
        <span>Round #{handNumber}</span>
        <span
          key={`poker-phase-${phasePulseTick}`}
          className={phasePulseTick > 0 ? 'stage-pulse stage-pulse-strong' : ''}
        >
          {phaseLabel}
        </span>
        <span>Ante {potSummary.ante}</span>
        <span>Min {potSummary.minRaise}</span>
        <span>{wordBankSize} words</span>
      </div>

      <div className="poker-felt">
        <div className="poker-felt-inner" />
        <div className="table-pot" aria-label={`Total pot ${potSummary.totalPot}`}>
          <span>Pot</span>
          <strong>{potSummary.totalPot}</strong>
        </div>

        <div
          className={`table-center${centerJudgeWord ? ' judge-center' : ''}${
            isJudgeTransferPending ? ' judge-center-pending' : ''
          }`}
          aria-label="Table center"
        >
          <span className="table-center-kicker">Similer</span>
          {centerJudgeWord ? (
            <div className="center-judge-slots">
              <div className="center-judge-slot center-word-slot">
                <span>Judge Word</span>
                <strong>{shouldShowJudgeCenter ? centerJudgeWord : '\u00a0'}</strong>
              </div>
              <div className="center-judge-slot center-name-slot">
                <span>Judge</span>
                <strong>{shouldShowJudgeCenter ? centerCopy : '\u00a0'}</strong>
              </div>
            </div>
          ) : (
            <>
              <strong>Words Hidden</strong>
              <span>{centerCopy}</span>
            </>
          )}
        </div>

        <div className="seat-ring" style={{ '--seat-count': fullVisualPlayers.length }}>
          {visualSeats.map(({ player, position }) => {
            const isDealer = dealerPlayerId === player.id
            const isActor = currentPlayerId === player.id
            const forceWordVisible =
              player.isJudge || phase === 'debate' || phase === 'showdownVoting' || handComplete
            const isWordVisible =
              forceWordVisible || Boolean(revealByPlayerId[player.id])
            const canControlWord =
              showWordControls &&
              player.inHand &&
              !forceWordVisible &&
              (wordControlPlayerId === null || wordControlPlayerId === player.id)
            const status = summarizePlayerStatus(player, isActor)
            const wordText = getWordText(player, isWordVisible)

            return (
              <article
                key={player.id}
                className={`table-seat${isActor ? ' active' : ''}${
                  player.folded ? ' folded' : ''
                }${player.stack <= 0 ? ' busted' : ''}`}
                style={{ '--seat-x': `${position.x}%`, '--seat-y': `${position.y}%` }}
              >
                <div className="seat-avatar-wrap">
                  <div className="seat-avatar" aria-hidden="true">
                    {player.name.slice(0, 1).toUpperCase()}
                  </div>
                  {isDealer ? <span className="dealer-token" aria-label={`${player.name} is dealer`}>D</span> : null}
                </div>

                <div className="seat-panels">
                  <div className="seat-panel seat-word-panel">
                    <strong title={wordText}>{wordText}</strong>
                    {canControlWord ? (
                      <button
                        type="button"
                        className="word-eye-button"
                        onClick={() => onToggleWordReveal(player.id)}
                        aria-label={isWordVisible ? `Hide ${player.name}'s word` : `Reveal ${player.name}'s word`}
                        title={isWordVisible ? 'Hide word' : 'Reveal word'}
                      >
                        <EyeIcon isHidden={!isWordVisible} />
                      </button>
                    ) : null}
                  </div>

                  <div className="seat-panel seat-identity-panel">
                    <div>
                      <strong title={player.name}>{player.name}</strong>
                      <span className="seat-chip-count">{player.stack}</span>
                    </div>
                    {isActor ? (
                      <span className="seat-state-pill turn-pill">Turn</span>
                    ) : (
                      <span className="seat-status-text">{status}</span>
                    )}
                  </div>
                </div>
              </article>
            )
          })}
        </div>

        {shouldRunJudgeTransfer && judge && judgeFlightPosition ? (
          <>
            <div
              ref={judgeWordFlightRef}
              className="judge-token-flight judge-word-flight"
              style={{
                '--seat-x': `${judgeFlightPosition.x}%`,
                '--seat-y': `${judgeFlightPosition.y}%`,
              }}
              aria-hidden="true"
            >
              <span>Judge Word</span>
              <strong>{centerJudgeWord}</strong>
            </div>
            <div
              ref={judgeNameFlightRef}
              className="judge-token-flight judge-name-flight"
              style={{
                '--seat-x': `${judgeFlightPosition.x}%`,
                '--seat-y': `${judgeFlightPosition.y}%`,
              }}
              aria-hidden="true"
            >
              <span>Judge</span>
              <strong>{centerCopy}</strong>
            </div>
          </>
        ) : null}
      </div>
    </section>
  )
}

export default PokerTable
