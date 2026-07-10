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
  const getPotAwardRuleText = (pot) => {
    if (pot.awardRule === 'main-showdown') {
      return ' by main showdown result'
    }

    if (pot.awardRule === 'side-pot-similarity') {
      const scoreText = Number.isFinite(pot.winningSimilarity)
        ? ` (${formatScore(pot.winningSimilarity)})`
        : ''
      return ` by side-pot similarity${scoreText}`
    }

    if (pot.awardRule === 'only-eligible') {
      return ' as the only eligible contender'
    }

    if (pot.awardRule === 'showdown-fallback') {
      return ' by showdown fallback'
    }

    return ''
  }
  const renderSidePots = () => {
    const sidePots = game.showdown?.sidePots ?? []
    const shouldShowSidePots =
      sidePots.length > 1 || sidePots.some((pot) => pot.reservedAmount > 0)

    if (!shouldShowSidePots) {
      return null
    }

    return sidePots
      .filter((pot) => pot.originalAmount > 0)
      .map((pot) => {
        const awardText =
          pot.amount > 0
            ? `${pot.amount} -> ${pot.winnerName}${getPotAwardRuleText(pot)}`
            : 'fully reserved'
        const reserveText =
          pot.reservedAmount > 0 ? ` (${pot.reservedAmount} reserved for judge payout)` : ''

        return (
          <p key={`side-pot-${pot.id}`}>
            Side Pot {pot.id}: {awardText}
            {reserveText}
          </p>
        )
      })
  }
  const renderPayouts = () => {
    return (game.showdown?.payouts ?? []).map((payout) => (
      <p key={payout.playerId}>Payout: {payout.playerName} +{payout.amount}</p>
    ))
  }
  const renderAllSimilarityScores = () => {
    const scores = game.showdown?.allSimilarityScores ?? []

    if (scores.length === 0) {
      return null
    }

    const displayScores = scores.filter((score) => !score.isJudge)

    if (displayScores.length === 0) {
      return null
    }

    const bestEligibleScore = displayScores.find((score) => score.eligible)
    const bestFoldedScore = displayScores.find((score) => score.folded)
    const hasFoldedNearMiss =
      bestFoldedScore &&
      bestEligibleScore &&
      Number.isFinite(bestFoldedScore.similarity) &&
      Number.isFinite(bestEligibleScore.similarity) &&
      bestFoldedScore.similarity > bestEligibleScore.similarity
    const judgeWord = game.showdown?.judgeWord ?? game.showdown?.judge?.word ?? game.judgeWord

    return (
      <div className="showdown-grid">
        <h4>All Similarity Scores</h4>
        <p>
          Judge word: <b>{judgeWord}</b>. Folded players are shown for
          curiosity, but were not eligible to win the pot.
        </p>
        {hasFoldedNearMiss ? (
          <p>
            Near miss: {bestFoldedScore.playerName} ({bestFoldedScore.word}) had
            the highest non-Judge similarity after folding.
          </p>
        ) : null}
        {displayScores.map((score) => (
          <p key={`similarity-score-${score.playerId}`}>
            {score.playerName} ({score.word}) | Similarity:{' '}
            {formatScore(score.similarity)} | {score.status}
          </p>
        ))}
      </div>
    )
  }

  return (
    <div
      key={`hand-complete-panel-${pulseTick}`}
      className={`hand-complete-panel${pulseTick > 0 ? ' stage-pulse stage-pulse-strong' : ''}`}
    >
      <button
        type="button"
        disabled={actionDisabled}
        onClick={game.tableComplete ? onStartNewGame : onBeginNextHand}
      >
        {game.tableComplete ? 'Start New Game' : 'Start Next Hand'}
      </button>

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
      {game.showdown?.type === 'uncontested' ? renderSidePots() : null}
      {game.showdown?.type === 'uncontested' ? renderPayouts() : null}

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
          {game.showdown.categories.playerVoteTieBrokenBySimilarity ? (
            <p>Player Vote tied, so similarity broke the Player Vote category.</p>
          ) : null}
          {game.showdown.contenders.map((contender) => (
            <p key={contender.playerId}>
              {contender.playerName} ({contender.word}) | Votes:{' '}
              {contender.playerVotesReceived} | Similarity:{' '}
              {formatScore(contender.similarity)} | Categories:{' '}
              {contender.categoryWins.join(', ') || 'none'}
            </p>
          ))}
          {renderSidePots()}
          {renderPayouts()}
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
          {renderSidePots()}
          {renderPayouts()}
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
          {renderSidePots()}
          {renderPayouts()}
        </div>
      ) : null}

      {renderAllSimilarityScores()}
    </div>
  )
}

export default HandCompletePanel
