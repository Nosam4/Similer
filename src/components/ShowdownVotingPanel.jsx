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
  submittedPlayerVoteIds = [],
  submittedPlayerVoteCount = 0,
  judgeVoteSubmitted = false,
  usesJudgeVote = true,
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
  const myPlayerVoteTargets = myContender
    ? contenders.filter((target) => target.id !== myContender.id)
    : []
  const isJudge = judge?.id === myPlayerId
  const isValidSubmittedPlayerVote = (voter) => {
    if (isOnlinePlaying) {
      return submittedPlayerVoteIds.includes(voter.id)
    }

    return false
  }
  const myPlayerVoteSubmitted =
    myContender && isValidSubmittedPlayerVote(myContender)
  const onlinePlayerVoteIsValid = myPlayerVoteTargets.some((target) => {
    return target.id === Number(onlinePlayerVoteValue)
  })

  if (isOnlinePlaying) {
    return (
      <div
        key={`showdown-panel-${pulseTick}`}
        className={`showdown-voting-panel${pulseTick > 0 ? ' stage-pulse stage-pulse-strong' : ''}`}
      >
        <h3>Showdown Voting</h3>
        {usesJudgeVote ? (
          <p>
            Judge word is <b>{displayJudgeWord}</b>. Each active contender submits
            their own player vote, and the judge submits the judge vote.
          </p>
        ) : (
          <p>
            Neutral judge word is <b>{displayJudgeWord}</b>. Each active
            contender submits a player vote. A clear majority wins; otherwise
            similarity decides.
          </p>
        )}

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
                {myPlayerVoteTargets.map((target) => (
                  <option key={target.id} value={target.id}>
                    {target.name} ({target.holeWord})
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={!onlinePlayerVoteIsValid || onlineGameBusy}
                onClick={onSubmitOnlinePlayerVote}
              >
                {myPlayerVoteSubmitted ? 'Update Player Vote' : 'Submit Player Vote'}
              </button>
            </label>
          ) : (
            <p>Only active contenders submit player votes.</p>
          )}

          {usesJudgeVote && isJudge ? (
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
          ) : usesJudgeVote ? (
            <p>Waiting for {judge?.name} to submit the judge vote.</p>
          ) : (
            <p>
              No judge vote this hand. A clear Player Vote majority can win the
              hand.
            </p>
          )}
        </div>

        <div className="showdown-grid">
          <p>
            Player votes submitted: {submittedPlayerVoteCount}/{contenders.length}
          </p>
          {contenders.map((voter) => (
            <p key={voter.id}>
              {voter.name} vote:{' '}
              {isValidSubmittedPlayerVote(voter) ? 'Submitted' : 'Pending'}
            </p>
          ))}
          {usesJudgeVote ? (
            <p>
              Judge vote ({judge?.name}): {judgeVoteSubmitted ? 'Submitted' : 'Pending'}
            </p>
          ) : (
            <p>Judge vote: Not used</p>
          )}
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
      {usesJudgeVote ? (
        <p>
          Judge word is <b>{displayJudgeWord}</b>. Submit every player vote plus the
          judge vote to resolve winner.
        </p>
      ) : (
        <p>
          Neutral judge word is <b>{displayJudgeWord}</b>. Submit every player vote.
          A clear majority wins; otherwise similarity decides.
        </p>
      )}

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
              {contenders
                .filter((target) => target.id !== voter.id)
                .map((target) => (
                  <option key={target.id} value={target.id}>
                    {target.name} ({target.holeWord})
                  </option>
                ))}
            </select>
          </label>
        ))}

        {usesJudgeVote ? (
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
        ) : (
          <p>No judge vote this hand.</p>
        )}
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
