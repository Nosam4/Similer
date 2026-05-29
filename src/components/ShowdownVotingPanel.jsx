import { formatScore } from './uiHelpers'

function ShowdownVotingPanel({
  judge,
  contenders,
  defaultPlayerVotes,
  effectivePlayerVotes,
  setPlayerVotes,
  effectiveJudgeVote,
  setJudgeVote,
  similarityRows,
  canResolveVotes,
  onResolveVotes,
  pulseTick = 0,
}) {
  return (
    <div
      key={`showdown-panel-${pulseTick}`}
      className={`showdown-voting-panel${pulseTick > 0 ? ' stage-pulse stage-pulse-strong' : ''}`}
    >
      <h3>Showdown Voting</h3>
      <p>
        Judge word is <b>{judge?.holeWord}</b>. Submit every player vote plus the
        judge vote to resolve winner.
      </p>

      <div className="votes-grid">
        {contenders.map((voter) => (
          <label key={voter.id}>
            {voter.name} vote
            <select
              value={effectivePlayerVotes[voter.id] ?? ''}
              onChange={(event) => {
                const nextTarget = event.target.value
                setPlayerVotes((previous) => ({
                  ...(Object.keys(previous).length > 0 ? previous : defaultPlayerVotes),
                  [voter.id]: nextTarget,
                }))
              }}
            >
              {contenders.map((target) => (
                <option key={target.id} value={target.id}>
                  {target.name} ({target.holeWord})
                </option>
              ))}
            </select>
          </label>
        ))}

        <label>
          Judge vote ({judge?.name})
          <select
            value={effectiveJudgeVote}
            onChange={(event) => setJudgeVote(event.target.value)}
          >
            {contenders.map((target) => (
              <option key={target.id} value={target.id}>
                {target.name} ({target.holeWord})
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="showdown-grid">
        {similarityRows.map((row) => (
          <p key={row.playerId}>
            Similarity | {row.playerName} ({row.playerWord})
            {' -> '}
            {judge?.holeWord}: {formatScore(row.similarity)}
          </p>
        ))}
      </div>

      <button type="button" disabled={!canResolveVotes} onClick={onResolveVotes}>
        Resolve Showdown
      </button>
    </div>
  )
}

export default ShowdownVotingPanel
