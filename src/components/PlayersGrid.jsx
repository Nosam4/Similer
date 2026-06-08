import { summarizePlayerStatus } from './uiHelpers'

function PlayersGrid({
  players,
  dealerIndex,
  currentPlayerIndex,
  phase,
  handComplete,
  revealByPlayerId,
  onToggleWordReveal,
  showWordControls = true,
}) {
  return (
    <section className="players-grid">
      {players.map((player, index) => {
        const isDealer = dealerIndex === index
        const isActor = currentPlayerIndex === index
        const forceWordVisible =
          player.isJudge || phase === 'debate' || phase === 'showdownVoting' || handComplete
        const isWordVisible = forceWordVisible || revealByPlayerId[player.id]
        const status = summarizePlayerStatus(player, isActor)

        return (
          <article
            key={player.id}
            className={`player-card${isActor ? ' active' : ''}${
              player.folded ? ' folded' : ''
            }${player.isJudge ? ' judge' : ''}`}
          >
            <div className="player-card-top">
              <h2>{player.name}</h2>
              <div className="player-badges" aria-label={`${player.name} table badges`}>
                {isDealer ? <span className="seat-badge">D</span> : null}
                {player.isJudge ? <span className="seat-badge judge-badge">Judge</span> : null}
                {isActor ? <span className="seat-badge turn-badge">Turn</span> : null}
              </div>
            </div>

            <div className="player-card-stats">
              <span>
                <strong>Stack</strong>
                {player.stack}
              </span>
              <span>
                <strong>Bet</strong>
                {player.betThisStreet}
              </span>
              <span>
                <strong>In</strong>
                {player.totalCommitted}
              </span>
            </div>

            <div className="player-card-footer">
              <span className="player-status">{status}</span>
              <span className="player-word">
                Word: {player.inHand ? (isWordVisible ? player.holeWord : '••••••') : '--'}
              </span>
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
          </article>
        )
      })}
    </section>
  )
}

export default PlayersGrid
