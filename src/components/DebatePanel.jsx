function DebatePanel({
  judge,
  judgeWord,
  contenders,
  isFinalDuel = false,
  isNeutralVoting = false,
  pulseTick = 0,
}) {
  return (
    <div
      key={`debate-panel-${pulseTick}`}
      className={`debate-panel${pulseTick > 0 ? ' stage-pulse stage-pulse-strong' : ''}`}
    >
      <h3>Closing Arguments</h3>
      <p>
        {judge ? (
          <>
            Judge: <b>{judge.name}</b>. Judge's Word: <b>{judgeWord}</b>.
          </>
        ) : (
          <>
            Neutral Judge's Word: <b>{judgeWord}</b>.
          </>
        )}{' '}
        Player words are now revealed.
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
          Make your final case to the Judge. Build on your opening argument,
          change your approach, or explain a bluff—whatever gives your real word
          the best chance to win.
        </p>
      )}

      <div className="showdown-grid">
        {contenders.map((player) => (
          <p key={player.id}>
            {player.name}: <b>{player.holeWord}</b>
          </p>
        ))}
      </div>

      <p>Voting begins after every contender marks argued.</p>
    </div>
  )
}

export default DebatePanel
