export const SERVER_SIMILARITY_SCORES_FIELD = '__serverSimilarityScores'

export function buildServerSimilarityScores(rows, expectedPlayerIds) {
  if (!Array.isArray(rows) || !Array.isArray(expectedPlayerIds)) {
    return null
  }

  const scores = {}

  for (const row of rows) {
    if (
      row?.player_id === null ||
      row?.player_id === undefined ||
      row?.score === null ||
      row?.score === undefined ||
      String(row.player_id).trim() === '' ||
      String(row.score).trim() === ''
    ) {
      return null
    }

    const playerId = Number(row?.player_id)
    const score = Number(row?.score)

    if (!Number.isInteger(playerId) || !Number.isFinite(score)) {
      return null
    }

    const key = String(playerId)
    if (Object.hasOwn(scores, key)) {
      return null
    }

    scores[key] = score
  }

  const normalizedExpectedIds = [...new Set(expectedPlayerIds.map(Number))]
  if (
    Object.keys(scores).length !== normalizedExpectedIds.length ||
    normalizedExpectedIds.some(
      (playerId) => !Number.isInteger(playerId) || !Object.hasOwn(scores, String(playerId)),
    )
  ) {
    return null
  }

  return scores
}

export function attachServerSimilarityScores(game, scores) {
  if (!game || !scores) {
    return game
  }

  return {
    ...game,
    [SERVER_SIMILARITY_SCORES_FIELD]: scores,
  }
}

export function removeServerSimilarityScores(game) {
  if (!game || !Object.hasOwn(game, SERVER_SIMILARITY_SCORES_FIELD)) {
    return game
  }

  const sanitized = { ...game }
  delete sanitized[SERVER_SIMILARITY_SCORES_FIELD]
  return sanitized
}

export function getServerSimilarityScore(game, playerId) {
  const scores = game?.[SERVER_SIMILARITY_SCORES_FIELD]

  if (!scores) {
    return null
  }

  const score = Number(scores[String(playerId)])
  return Number.isFinite(score) ? score : null
}
