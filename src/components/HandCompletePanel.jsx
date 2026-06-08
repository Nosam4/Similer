import { formatScore } from './uiHelpers'

function HandCompletePanel({
  game,
  onBeginNextHand,
  onStartNewGame,
  actionDisabled = false,
  pulseTick = 0,
  winnerPulseTick = 0,
}) {
  const winnerLineClassName =
    winnerPulseTick > 0 ? 'winner-line stage-pulse stage-pulse-strong' : 'winner-line'
  const tableWinner = game.tableComplete
    ? game.players.find((player) => player.stack > 0)
    : null
  const getPlayerName = (playerId, fallback = 'No clear majority') => {
    return game.players.find((player) => player.id === playerId)?.name ?? fallback
  }

  return (
    <div
      key={`hand-complete-panel-${pulseTick}`}
      className={`hand-complete-panel${pulseTick > 0 ? ' stage-pulse stage-pulse-strong' : ''}`}
    >
      <h3>Hand Complete</h3>
      {tableWinner ? (
        <p key={`table-winner-line-${winnerPulseTick}`} className={winnerLineClassName}>
          Table Winner: {tableWinner.name} wins the game with {tableWinner.stack} chips.
        </p>
      ) : null}

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
            {getPlayerName(game.showdown.categories.playerVoteWinnerId, '--')}, Judge
            Vote = {getPlayerName(game.showdown.categories.judgeVoteWinnerId, '--')},
            Similarity = {getPlayerName(game.showdown.categories.similarityWinnerId, '--')}
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

      {game.showdown?.type === 'similarityDuel' ? (
        <div className="showdown-grid">
          <p key={`winner-line-${winnerPulseTick}`} className={winnerLineClassName}>
            Final Duel Winner: {game.showdown.winner.playerName} (
            {game.showdown.winner.word})
          </p>
          <p>
            Neutral Judge Word: <b>{game.showdown.judgeWord}</b>
          </p>
          <p>Winner logic: similarity score decides the two-player showdown.</p>
          {game.showdown.contenders.map((contender) => (
            <p key={contender.playerId}>
              {contender.playerName} ({contender.word}) | Similarity:{' '}
              {formatScore(contender.similarity)}
            </p>
          ))}
          {game.showdown.payouts.map((payout) => (
            <p key={payout.playerId}>Payout: {payout.playerName} +{payout.amount}</p>
          ))}
        </div>
      ) : null}

      {game.showdown?.type === 'neutralVoting' ? (
        <div className="showdown-grid">
          <p key={`winner-line-${winnerPulseTick}`} className={winnerLineClassName}>
            Winner: {game.showdown.winner.playerName} ({game.showdown.winner.word})
          </p>
          <p>
            Neutral Judge Word: <b>{game.showdown.judgeWord}</b>
          </p>
          <p>
            Category winners: Player Vote ={' '}
            {getPlayerName(game.showdown.categories.playerVoteWinnerId)}, Similarity ={' '}
            {getPlayerName(game.showdown.categories.similarityWinnerId, '--')}
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

      <button
        type="button"
        disabled={actionDisabled}
        onClick={game.tableComplete ? onStartNewGame : onBeginNextHand}
      >
        {game.tableComplete ? 'Start New Game' : 'Start Next Hand'}
      </button>
    </div>
  )
}

export default HandCompletePanel
