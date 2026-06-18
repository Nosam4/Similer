function DebatePanel({
  judge,
  judgeWord,
  contenders,
  isFinalDuel = false,
  isNeutralVoting = false,
  canCompleteDebate = true,
  onCompleteDebate,
  onlineGameBusy = false,
  pulseTick = 0,
}) {
  const judgeLabel = judge ? `${judge.name}'s word` : 'Neutral judge word'
  const buttonLabel = isFinalDuel
    ? 'Reveal Similarity Winner'
    : isNeutralVoting
      ? 'Begin Player Voting'
      : 'Begin Showdown Voting'

  return (
    <div
      key={`debate-panel-${pulseTick}`}
      className={`debate-panel${pulseTick > 0 ? ' stage-pulse stage-pulse-strong' : ''}`}
    >
      <h3>Closing Arguments</h3>
      <p>
        {judgeLabel} is <b>{judgeWord}</b>. Player words are now revealed.
      </p>
      {isFinalDuel ? (
        <p>
          Final Duel: both players stay active, no judge vote is used, and
          similarity decides the winner after arguments.
        </p>
      ) : isNeutralVoting ? (
        <p>
          All-in protection is active: no contender becomes the judge. Player
          Vote wins with a clear majority; otherwise similarity decides after
          arguments.
        </p>
      ) : (
        <p>
          Each contender should argue their assigned word now. No decoys, no
          fake words, just the best case for the real connection.
        </p>
      )}

      <div className="showdown-grid">
        {contenders.map((player) => (
          <p key={player.id}>
            {player.name}: <b>{player.holeWord}</b>
          </p>
        ))}
      </div>

      {canCompleteDebate ? (
        <button type="button" disabled={onlineGameBusy} onClick={onCompleteDebate}>
          {buttonLabel}
        </button>
      ) : (
        <p>Watch the debate. An active player can move the hand forward.</p>
      )}
    </div>
  )
}

export default DebatePanel
