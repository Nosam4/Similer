import { useLayoutEffect, useRef, useState } from 'react'
import { gsap } from 'gsap'
import { summarizePlayerStatus } from './uiHelpers'

const STAGE_OVERLAY_DURATION_MS = 5200

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
  viewerPlayerId = null,
}) {
  const flightCardRef = useRef(null)
  const transferDelayRef = useRef(null)
  const [settledTransferKey, setSettledTransferKey] = useState('')
  const dealerPlayerId = getPlayerIdAtIndex(players, dealerIndex)
  const currentPlayerId = getPlayerIdAtIndex(players, currentPlayerIndex)
  const judgeId = judge?.id ?? null
  const judgeTransferKey = judgeId === null ? '' : `${handNumber}:${judgeId}`
  const centerJudgeWord = judge?.holeWord ?? judgeWord
  const isJudgeSettled = Boolean(judge && settledTransferKey === judgeTransferKey)
  const isJudgeTransferActive = Boolean(
    judge && centerJudgeWord && judgeTransferKey && !isJudgeSettled,
  )
  const tablePlayers = judge && isJudgeSettled ? players.filter((player) => player.id !== judge.id) : players
  const visualPlayers = rotatePlayersForViewer(tablePlayers, viewerPlayerId)
  const layout = getSeatLayout(visualPlayers.length)
  const fullVisualPlayers = rotatePlayersForViewer(players, viewerPlayerId)
  const fullLayout = getSeatLayout(fullVisualPlayers.length)
  const judgeFlightIndex = fullVisualPlayers.findIndex((player) => player.id === judge?.id)
  const judgeFlightPosition =
    judgeFlightIndex >= 0 ? fullLayout[judgeFlightIndex] ?? fullLayout[fullLayout.length - 1] : null
  const shouldShowJudgeCenter = Boolean(centerJudgeWord && !isJudgeTransferActive)
  const centerCopy = judge
    ? `${judge.name}${dealerPlayerId === judge.id ? ' · Dealer' : ''}`
    : judgeWord
      ? 'Neutral judge word'
      : 'Judge word revealed after opening statements'

  useLayoutEffect(() => {
    if (!isJudgeTransferActive || !flightCardRef.current) {
      return undefined
    }

    const flightCard = flightCardRef.current
    const avatar = flightCard.querySelector('.seat-avatar-wrap')
    const chipPanel = flightCard.querySelector('.seat-chip-panel')
    const timeline = gsap.timeline({
      paused: true,
      defaults: { ease: 'power3.inOut' },
      onComplete: () => {
        setSettledTransferKey(judgeTransferKey)
      },
    })

    gsap.set(flightCard, { autoAlpha: 0, scale: 1 })
    timeline
      .set(flightCard, { autoAlpha: 1 })
      .to(flightCard, {
        left: '50%',
        top: '50%',
        scale: 1.08,
        duration: 1.2,
      })

    if (avatar) {
      timeline.to(avatar, { autoAlpha: 0, scale: 0.68, duration: 0.3 }, '-=0.36')
    }

    if (chipPanel) {
      timeline.to(chipPanel, { autoAlpha: 0, y: 8, duration: 0.24 }, '<')
    }

    timeline
      .to(flightCard, { autoAlpha: 0, duration: 0.22 }, '+=0.08')

    transferDelayRef.current = window.setTimeout(() => {
      timeline.paused(false)
    }, STAGE_OVERLAY_DURATION_MS)

    return () => {
      window.clearTimeout(transferDelayRef.current)
      timeline.kill()
    }
  }, [isJudgeTransferActive, judgeTransferKey])

  return (
    <section className="poker-table-shell" aria-label="Similer table">
      <div className="poker-table-meta" aria-label="Hand summary">
        <span>Hand {handNumber}</span>
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

        <div className={`table-center${shouldShowJudgeCenter ? ' judge-center' : ''}`} aria-label="Table center">
          <span className="table-center-kicker">Similer</span>
          {shouldShowJudgeCenter ? (
            <>
              <span className="judge-center-label">Judge Word</span>
              <strong>{centerJudgeWord}</strong>
              <span>{centerCopy}</span>
            </>
          ) : (
            <>
              <strong>Words Hidden</strong>
              <span>{centerCopy}</span>
            </>
          )}
        </div>

        <div className="seat-ring" style={{ '--seat-count': visualPlayers.length }}>
          {visualPlayers.map((player, index) => {
            const position = layout[index] ?? layout[layout.length - 1]
            const isDealer = dealerPlayerId === player.id
            const isActor = currentPlayerId === player.id
            const forceWordVisible =
              player.isJudge || phase === 'debate' || phase === 'showdownVoting' || handComplete
            const isViewerPlayer = viewerPlayerId === player.id
            const isWordVisible =
              forceWordVisible || Boolean(revealByPlayerId[player.id]) || Boolean(isViewerPlayer && player.holeWord)
            const status = summarizePlayerStatus(player, isActor)
            const wordText = getWordText(player, isWordVisible)
            const isTransferSource = isJudgeTransferActive && player.id === judge?.id

            return (
              <article
                key={player.id}
                className={`table-seat${isActor ? ' active' : ''}${
                  player.folded ? ' folded' : ''
                }${player.stack <= 0 ? ' busted' : ''}${isTransferSource ? ' transfer-source' : ''}`}
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
                    <strong title={wordText}>Word: {wordText}</strong>
                    {showWordControls && player.inHand && !forceWordVisible ? (
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

                  <div className="seat-panel seat-name-panel">
                    <strong title={player.name}>{player.name}</strong>
                    {isActor ? <span className="seat-state-pill turn-pill">Turn</span> : null}
                  </div>

                  <div className="seat-panel seat-chip-panel">
                    <strong>{player.stack}</strong>
                    <span>{status}</span>
                  </div>
                </div>
              </article>
            )
          })}
        </div>

        {isJudgeTransferActive && judge && judgeFlightPosition ? (
          <div
            ref={flightCardRef}
            className="table-seat judge-flight-card"
            style={{
              '--seat-x': `${judgeFlightPosition.x}%`,
              '--seat-y': `${judgeFlightPosition.y}%`,
            }}
            aria-hidden="true"
          >
            <div className="seat-avatar-wrap">
              <div className="seat-avatar">{judge.name.slice(0, 1).toUpperCase()}</div>
              {dealerPlayerId === judge.id ? <span className="dealer-token">D</span> : null}
            </div>

            <div className="seat-panels">
              <div className="seat-panel seat-word-panel">
                <strong title={centerJudgeWord}>Word: {centerJudgeWord}</strong>
              </div>
              <div className="seat-panel seat-name-panel">
                <strong title={judge.name}>{judge.name}</strong>
              </div>
              <div className="seat-panel seat-chip-panel">
                <strong>{judge.stack}</strong>
                <span>Becomes Judge</span>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  )
}

export default PokerTable
