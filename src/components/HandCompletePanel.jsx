import { formatScore } from './uiHelpers'

function HandCompletePanel({
  game,
  onBeginNextHand,
  pulseTick = 0,
  winnerPulseTick = 0,
}) {
  const winnerLineClassName =
    winnerPulseTick > 0 ? 'winner-line stage-pulse stage-pulse-strong' : 'winner-line'

  return (
    <div
      key={`hand-complete-panel-${pulseTick}`}
      className={`hand-complete-panel${pulseTick > 0 ? ' stage-pulse stage-pulse-strong' : ''}`}
    >
      <h3>Hand Complete</h3>
      {game.showdown?.type === 'uncontested' ? (
        <p key={`winner-line-${winnerPulseTick}`} className={winnerLineClassName}>
          {game.showdown.winnerName} won uncontested for {game.showdown.amount}.
        </p>
      ) : null}

      {game.showdown?.type === 'voting' ? (
        <div className="showdown-grid">
          <p key={`winner-line-${winnerPulseTick}`} className={winnerLineClassName}>
            Winner: {game.showdown.winner.playerName} ({game.showdown.winner.word})
          </p>
          <p>
            Category winners: Player Vote ={' '}
            {
              game.players.find(
                (player) => player.id === game.showdown.categories.playerVoteWinnerId,
              )?.name
            }
            , Judge Vote ={' '}
            {
              game.players.find(
                (player) => player.id === game.showdown.categories.judgeVoteWinnerId,
              )?.name
            }
            , Similarity ={' '}
            {
              game.players.find(
                (player) => player.id === game.showdown.categories.similarityWinnerId,
              )?.name
            }
          </p>
          {game.showdown.contenders.map((contender) => (
            <p key={contender.playerId}>
              {contender.playerName} ({contender.word}) | Votes:{' '}
              {contender.playerVotesReceived} | Similarity:{' '}
              {formatScore(contender.similarity)} | Categories:{' '}
              {contender.categoryWins.join(', ') || 'none'}
            </p>
          ))}
          {game.showdown.payouts.map((payout) => (
            <p key={payout.playerId}>Payout: {payout.playerName} +{payout.amount}</p>
          ))}
        </div>
      ) : null}

      <button type="button" onClick={onBeginNextHand}>
        Start Next Hand
      </button>
    </div>
  )
}

export default HandCompletePanel
