function hasContender(contenders, playerId) {
  return contenders.some((contender) => contender.id === playerId)
}

export function buildDefaultPlayerVotes({ isShowdownVoting, contenders, playerVoteVoters }) {
  if (!isShowdownVoting || contenders.length === 0) {
    return {}
  }

  const defaults = {}

  for (const voter of playerVoteVoters) {
    const fallback = contenders.find((candidate) => candidate.id !== voter.id) ?? contenders[0]
    defaults[voter.id] = String(fallback.id)
  }

  return defaults
}

export function getEffectivePlayerVotes({ isOnlinePlaying, playerVotes, defaultPlayerVotes }) {
  if (isOnlinePlaying) {
    return {}
  }

  return Object.keys(playerVotes).length > 0 ? playerVotes : defaultPlayerVotes
}

export function getEffectiveJudgeVote({ judge, isOnlinePlaying, judgeVote, contenders }) {
  if (!judge || isOnlinePlaying) {
    return ''
  }

  return judgeVote || (contenders.length > 0 ? String(contenders[0].id) : '')
}

export function isValidPlayerVote({ voterId, value, contenders }) {
  const targetId = Number(value)

  return (
    value !== undefined &&
    value !== null &&
    value !== '' &&
    targetId !== voterId &&
    hasContender(contenders, targetId)
  )
}

export function countSubmittedPlayerVotes({
  isOnlinePlaying,
  playerVoteVoters,
  onlineSubmittedPlayerVoteIds,
  effectivePlayerVotes,
  contenders,
}) {
  if (isOnlinePlaying) {
    return playerVoteVoters.filter((voter) => onlineSubmittedPlayerVoteIds.includes(voter.id))
      .length
  }

  return playerVoteVoters.filter((voter) => {
    return isValidPlayerVote({
      voterId: voter.id,
      value: effectivePlayerVotes[voter.id],
      contenders,
    })
  }).length
}

export function canResolveShowdownVotes({
  isShowdownVoting,
  contenders,
  isOnlinePlaying,
  submittedPlayerVoteCount,
  playerVoteVoters,
  judgeVoteSubmitted,
  effectivePlayerVotes,
  judge,
  effectiveJudgeVote,
}) {
  if (!isShowdownVoting || contenders.length <= 1) {
    return false
  }

  if (isOnlinePlaying) {
    return submittedPlayerVoteCount === playerVoteVoters.length && judgeVoteSubmitted
  }

  return (
    playerVoteVoters.every((voter) => {
      return isValidPlayerVote({
        voterId: voter.id,
        value: effectivePlayerVotes[voter.id],
        contenders,
      })
    }) &&
    (!judge || effectiveJudgeVote !== '')
  )
}
