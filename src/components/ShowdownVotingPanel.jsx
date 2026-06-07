import { formatScore } from './uiHelpers'

function ShowdownVotingPanel({
  judge,
  judgeWord = null,
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
  isOnlinePlaying = false,
  myPlayerId = null,
  submittedPlayerVotes = {},
  submittedPlayerVoteCount = 0,
  judgeVoteSubmitted = false,
  onlineGameBusy = false,
  onlinePlayerVoteValue = '',
  setOnlinePlayerVoteValue = null,
  onSubmitOnlinePlayerVote = null,
  onlineJudgeVoteValue = '',
  setOnlineJudgeVoteValue = null,
  onSubmitOnlineJudgeVote = null,
}) {
  const displayJudgeWord = judge?.holeWord ?? judgeWord
  const myContender = contenders.find((player) => player.id === myPlayerId) ?? null
  const isJudge = judge?.id === myPlayerId
  const myPlayerVoteSubmitted =
    myContender && submittedPlayerVotes[myPlayerId] !== undefined && submittedPlayerVotes[myPlayerId] !== ''

  if (isOnlinePlaying) {
    return (
      <div
        key={`showdown-panel-${pulseTick}`}
        className={`showdown-voting-panel${pulseTick > 0 ? ' stage-pulse stage-pulse-strong' : ''}`}
      >
        <h3>Showdown Voting</h3>
        <p>
          Judge word is <b>{displayJudgeWord}</b>. Each active contender submits
          their own player vote, and the judge submits the judge vote.
        </p>

        <div className="votes-grid">
          {myContender ? (
            <label>
              Your player vote
              <select
                value={onlinePlayerVoteValue}
                disabled={onlineGameBusy}
                onChange={(event) => setOnlinePlayerVoteValue?.(event.target.value)}
              >
                <option value="">Choose a player</option>
                {contenders.map((target) => (
                  <option key={target.id} value={target.id}>
                    {target.name} ({target.holeWord})
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={!onlinePlayerVoteValue || onlineGameBusy}
                onClick={onSubmitOnlinePlayerVote}
              >
                {myPlayerVoteSubmitted ? 'Update Player Vote' : 'Submit Player Vote'}
              </button>
            </label>
          ) : (
            <p>Only active contenders submit player votes.</p>
          )}

          {isJudge ? (
            <label>
              Your judge vote
              <select
                value={onlineJudgeVoteValue}
                disabled={onlineGameBusy}
                onChange={(event) => setOnlineJudgeVoteValue?.(event.target.value)}
              >
                <option value="">Choose a player</option>
                {contenders.map((target) => (
                  <option key={target.id} value={target.id}>
                    {target.name} ({target.holeWord})
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={!onlineJudgeVoteValue || onlineGameBusy}
                onClick={onSubmitOnlineJudgeVote}
              >
                {judgeVoteSubmitted ? 'Update Judge Vote' : 'Submit Judge Vote'}
              </button>
            </label>
          ) : (
            <p>Waiting for {judge?.name} to submit the judge vote.</p>
          )}
        </div>

        <div className="showdown-grid">
          <p>
            Player votes submitted: {submittedPlayerVoteCount}/{contenders.length}
          </p>
          {contenders.map((voter) => (
            <p key={voter.id}>
              {voter.name} vote:{' '}
              {submittedPlayerVotes[voter.id] !== undefined && submittedPlayerVotes[voter.id] !== ''
                ? 'Submitted'
                : 'Pending'}
            </p>
          ))}
          <p>
            Judge vote ({judge?.name}): {judgeVoteSubmitted ? 'Submitted' : 'Pending'}
          </p>
        </div>

        <button
          type="button"
          disabled={!canResolveVotes || onlineGameBusy}
          onClick={onResolveVotes}
        >
          {canResolveVotes ? 'Resolve Showdown' : 'Waiting for Votes'}
        </button>
      </div>
    )
  }

  return (
    <div
      key={`showdown-panel-${pulseTick}`}
      className={`showdown-voting-panel${pulseTick > 0 ? ' stage-pulse stage-pulse-strong' : ''}`}
    >
      <h3>Showdown Voting</h3>
      <p>
        Judge word is <b>{displayJudgeWord}</b>. Submit every player vote plus the
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
            {displayJudgeWord}: {formatScore(row.similarity)}
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
