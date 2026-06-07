function DebatePanel({
  judge,
  judgeWord,
  contenders,
  isFinalDuel = false,
  canCompleteDebate = true,
  onCompleteDebate,
  onlineGameBusy = false,
  pulseTick = 0,
}) {
  const judgeLabel = judge ? `${judge.name}'s word` : 'Neutral judge word'
  const buttonLabel = isFinalDuel ? 'Reveal Similarity Winner' : 'Begin Showdown Voting'

  return (
    <div
      key={`debate-panel-${pulseTick}`}
      className={`debate-panel${pulseTick > 0 ? ' stage-pulse stage-pulse-strong' : ''}`}
    >
      <h3>Debate Stage</h3>
      <p>
        {judgeLabel} is <b>{judgeWord}</b>. Player words are now revealed.
      </p>
      {isFinalDuel ? (
        <p>
          Final Duel: both players stay active, no judge vote is used, and
          similarity decides the winner after arguments.
        </p>
      ) : (
        <p>
          Each contender should argue why their word connects most closely to
          the judge word. When debate is done, move to voting.
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
