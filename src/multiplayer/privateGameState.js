function cloneGame(game) {
  return structuredClone(game)
}

export function buildWordMap(rows = []) {
  const wordMap = {}

  for (const row of rows) {
    if (row?.word && row.player_id !== undefined && row.player_id !== null) {
      wordMap[Number(row.player_id)] = row.word
    }
  }

  return wordMap
}

export function hydrateGameWithWords(game, wordsByPlayerId) {
  if (!game || !wordsByPlayerId || Object.keys(wordsByPlayerId).length === 0) {
    return game
  }

  const hydrated = cloneGame(game)

  hydrated.players = hydrated.players.map((player) => {
    const privateWord = wordsByPlayerId[player.id]

    if (!privateWord || player.holeWord) {
      return player
    }

    return {
      ...player,
      holeWord: privateWord,
    }
  })

  const judge = hydrated.players.find((player) => player.id === hydrated.judgePlayerId)

  if (!hydrated.judgeWord && judge?.holeWord) {
    hydrated.judgeWord = judge.holeWord
  }

  return hydrated
}

export function buildSubmittedPlayerVoteIds(statusRows = []) {
  return statusRows
    .filter((row) => row.vote_type === 'player' && row.submitted)
    .map((row) => Number(row.voter_player_id))
}

export function hasSubmittedJudgeVote(statusRows = []) {
  return statusRows.some((row) => row.vote_type === 'judge' && row.submitted)
}
