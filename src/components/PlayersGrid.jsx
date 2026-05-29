import { summarizePlayerStatus } from './uiHelpers'

function PlayersGrid({
  players,
  dealerIndex,
  currentPlayerIndex,
  phase,
  handComplete,
  revealByPlayerId,
  onToggleWordReveal,
}) {
  return (
    <section className="players-grid">
      {players.map((player, index) => {
        const isDealer = dealerIndex === index
        const isActor = currentPlayerIndex === index
        const forceWordVisible =
          player.isJudge || phase === 'showdownVoting' || handComplete
        const isWordVisible = forceWordVisible || revealByPlayerId[player.id]

        return (
          <article
            key={player.id}
            className={`player-card${isActor ? ' active' : ''}${
              player.folded ? ' folded' : ''
            }${player.isJudge ? ' judge' : ''}`}
          >
            <h2>
              {player.name} {isDealer ? '(D)' : ''} {player.isJudge ? '(Judge)' : ''}
            </h2>
            <p>Stack: {player.stack}</p>
            <p>Street Bet: {player.betThisStreet}</p>
            <p>Total Committed: {player.totalCommitted}</p>
            <p>Status: {summarizePlayerStatus(player, isActor)}</p>
            <p>
              Word:{' '}
              {player.inHand ? (isWordVisible ? player.holeWord : '••••••') : '--'}
            </p>
            {player.inHand && !forceWordVisible ? (
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
