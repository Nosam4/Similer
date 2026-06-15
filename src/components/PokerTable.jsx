import { summarizePlayerStatus } from './uiHelpers'

const SEAT_LAYOUTS = {
  2: [
    { x: 50, y: 88 },
    { x: 50, y: 12 },
  ],
  3: [
    { x: 50, y: 88 },
    { x: 16, y: 34 },
    { x: 84, y: 34 },
  ],
  4: [
    { x: 50, y: 88 },
    { x: 14, y: 50 },
    { x: 50, y: 12 },
    { x: 86, y: 50 },
  ],
  5: [
    { x: 50, y: 88 },
    { x: 16, y: 64 },
    { x: 24, y: 20 },
    { x: 76, y: 20 },
    { x: 84, y: 64 },
  ],
  6: [
    { x: 50, y: 88 },
    { x: 18, y: 72 },
    { x: 18, y: 28 },
    { x: 50, y: 12 },
    { x: 82, y: 28 },
    { x: 82, y: 72 },
  ],
  7: [
    { x: 50, y: 88 },
    { x: 20, y: 76 },
    { x: 12, y: 42 },
    { x: 32, y: 14 },
    { x: 68, y: 14 },
    { x: 88, y: 42 },
    { x: 80, y: 76 },
  ],
  8: [
    { x: 50, y: 88 },
    { x: 24, y: 78 },
    { x: 12, y: 50 },
    { x: 24, y: 22 },
    { x: 50, y: 12 },
    { x: 76, y: 22 },
    { x: 88, y: 50 },
    { x: 76, y: 78 },
  ],
}

function getSeatLayout(playerCount) {
  return SEAT_LAYOUTS[playerCount] ?? SEAT_LAYOUTS[8]
}

function PokerTable({
  players,
  dealerIndex,
  smallBlindIndex = null,
  bigBlindIndex = null,
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
}) {
  const layout = getSeatLayout(players.length)
  const judgeText = judge
    ? `${judge.name}: ${judge.holeWord ?? judgeWord ?? 'revealed soon'}`
    : judgeWord
      ? `Neutral word: ${judgeWord}`
      : 'Judge word revealed after preflop'

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
        <span>Pot {potSummary.totalPot}</span>
        <span>Bet {potSummary.currentBet}</span>
        <span>Min {potSummary.minRaise}</span>
        <span>{wordBankSize} words</span>
      </div>

      <div className="poker-felt">
        <div className="poker-felt-inner" />
        <div className="table-center" aria-label="Table center">
          <span className="table-center-kicker">Similer</span>
          <strong>Total Pot {potSummary.totalPot}</strong>
          <span>{judgeText}</span>
        </div>

        <div className="seat-ring" style={{ '--seat-count': players.length }}>
          {players.map((player, index) => {
            const position = layout[index] ?? layout[layout.length - 1]
            const isDealer = dealerIndex === index
            const isSmallBlind = smallBlindIndex === index
            const isBigBlind = bigBlindIndex === index
            const isActor = currentPlayerIndex === index
            const forceWordVisible =
              player.isJudge || phase === 'debate' || phase === 'showdownVoting' || handComplete
            const isWordVisible = forceWordVisible || revealByPlayerId[player.id]
            const status = summarizePlayerStatus(player, isActor)

            return (
              <article
                key={player.id}
                className={`table-seat${isActor ? ' active' : ''}${
                  player.folded ? ' folded' : ''
                }${player.isJudge ? ' judge' : ''}${player.stack <= 0 ? ' busted' : ''}`}
                style={{ '--seat-x': `${position.x}%`, '--seat-y': `${position.y}%` }}
              >
                <div className="seat-avatar" aria-hidden="true">
                  {player.name.slice(0, 1).toUpperCase()}
                </div>

                <div className="seat-content">
                  <div className="seat-heading">
                    <h2>{player.name}</h2>
                    <div className="player-badges" aria-label={`${player.name} table badges`}>
                      {isDealer ? <span className="seat-badge">D</span> : null}
                      {isSmallBlind ? <span className="seat-badge small-blind-badge">SB</span> : null}
                      {isBigBlind ? <span className="seat-badge big-blind-badge">BB</span> : null}
                      {player.isJudge ? <span className="seat-badge judge-badge">Judge</span> : null}
                      {isActor ? <span className="seat-badge turn-badge">Turn</span> : null}
                    </div>
                  </div>

                  <div className="seat-numbers" aria-label={`${player.name} chip counts`}>
                    <span>
                      <b>{player.stack}</b>
                      Stack
                    </span>
                    <span>
                      <b>{player.betThisStreet}</b>
                      Bet
                    </span>
                    <span>
                      <b>{player.totalCommitted}</b>
                      In
                    </span>
                  </div>

                  <div className="seat-footer">
                    <span>{status}</span>
                    <strong>
                      Word: {player.inHand ? (isWordVisible ? player.holeWord : '••••••') : '--'}
                    </strong>
                  </div>

                  {showWordControls && player.inHand && !forceWordVisible ? (
                    <button
                      type="button"
                      className="tiny"
                      onClick={() => onToggleWordReveal(player.id)}
                    >
                      {isWordVisible ? 'Hide Word' : 'Reveal Word'}
                    </button>
                  ) : null}
                </div>
              </article>
            )
          })}
        </div>
      </div>
    </section>
  )
}

export default PokerTable
