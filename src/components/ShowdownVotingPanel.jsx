function ShowdownVotingPanel({
  judge,
  judgeWord = null,
  contenders,
  playerVoteVoters = [],
  defaultPlayerVotes,
  effectivePlayerVotes,
  setPlayerVotes,
  effectiveJudgeVote,
  setJudgeVote,
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
  const myPlayerVoteVoter = playerVoteVoters.find((player) => player.id === myPlayerId) ?? null
  const myIsContender = contenders.some((player) => player.id === myPlayerId)
  const myPlayerVoteTargets = myPlayerVoteVoter
    ? contenders.filter((target) => !myIsContender || target.id !== myPlayerVoteVoter.id)
    : []
  const isJudge = judge?.id === myPlayerId
  const isValidSubmittedPlayerVote = (voter) => {
    if (isOnlinePlaying) {
      return submittedPlayerVoteIds.includes(voter.id)
    }

    return false
  }
  const myPlayerVoteSubmitted =
    myPlayerVoteVoter && isValidSubmittedPlayerVote(myPlayerVoteVoter)
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
            Judge word is <b>{displayJudgeWord}</b>. Everyone except the Judge
            submits a Player Vote, and only active contenders can receive votes.
          </p>
        ) : (
          <p>
            Neutral judge word is <b>{displayJudgeWord}</b>. Everyone at the
            table submits a Player Vote for an active contender. A clear majority
            wins; otherwise similarity decides.
          </p>
        )}

        <div className="votes-grid">
          {myPlayerVoteVoter ? (
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
            <p>The Judge does not submit a Player Vote.</p>
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
            Player votes submitted: {submittedPlayerVoteCount}/{playerVoteVoters.length}
          </p>
          {playerVoteVoters.map((voter) => (
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
          Judge word is <b>{displayJudgeWord}</b>. Everyone except the Judge
          submits a Player Vote, then the Judge submits the Judge Vote.
        </p>
      ) : (
        <p>
          Neutral judge word is <b>{displayJudgeWord}</b>. Everyone at the table
          submits a Player Vote. A clear majority wins; otherwise similarity
          decides.
        </p>
      )}

      <div className="votes-grid">
        {playerVoteVoters.map((voter) => (
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

      <button type="button" disabled={!canResolveVotes} onClick={onResolveVotes}>
        Resolve Showdown
      </button>
    </div>
  )
}

export default ShowdownVotingPanel
