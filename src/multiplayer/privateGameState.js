const PUBLIC_WORD_PHASES = new Set(['debate', 'showdownVoting', 'handComplete'])

function cloneGame(game) {
  return structuredClone(game)
}

export function shouldPublishWord(game, player) {
  if (!player?.holeWord) {
    return false
  }

  if (player.isJudge) {
    return true
  }

  return Boolean(player.inHand && (PUBLIC_WORD_PHASES.has(game.phase) || game.handComplete))
}

export function sanitizeGameForRoomState(game) {
  const sanitized = cloneGame(game)
  delete sanitized.onlineVotes

  sanitized.players = sanitized.players.map((player) => {
    if (shouldPublishWord(sanitized, player)) {
      return player
    }

    return {
      ...player,
      holeWord: null,
    }
  })

  return sanitized
}

export function extractPrivateHandWords(game) {
  return game.players
    .filter((player) => player.inHand && player.holeWord)
    .map((player) => ({
      playerId: player.id,
      word: player.holeWord,
    }))
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

export function getPublicRevealPlayerIds(game) {
  if (!game || !PUBLIC_WORD_PHASES.has(game.phase)) {
    return []
  }

  return game.players
    .filter((player) => player.inHand && !player.folded)
    .map((player) => player.id)
}

export function applyRevealedWordsToGame(game, rows = []) {
  if (!game || rows.length === 0) {
    return game
  }

  const wordMap = buildWordMap(rows)
  const nextGame = hydrateGameWithWords(game, wordMap)
  const judgeWord = nextGame.players.find((player) => player.id === nextGame.judgePlayerId)?.holeWord

  if (judgeWord) {
    nextGame.judgeWord = judgeWord
    nextGame.log = nextGame.log.map((entry) => {
      return entry
        .replace('Judge word: "null"', `Judge word: "${judgeWord}"`)
        .replace('Judge word: "undefined"', `Judge word: "${judgeWord}"`)
        .replace('Judge word: ""', `Judge word: "${judgeWord}"`)
        .replace('connection to "null"', `connection to "${judgeWord}"`)
        .replace('connection to "undefined"', `connection to "${judgeWord}"`)
        .replace('connection to ""', `connection to "${judgeWord}"`)
    })
  }

  return nextGame
}

export function buildSubmittedPlayerVoteIds(statusRows = []) {
  return statusRows
    .filter((row) => row.vote_type === 'player' && row.submitted)
    .map((row) => Number(row.voter_player_id))
}

export function hasSubmittedJudgeVote(statusRows = []) {
  return statusRows.some((row) => row.vote_type === 'judge' && row.submitted)
}

export function buildVotesPayload(voteRows = []) {
  const playerVotes = {}
  let judgeVote = ''

  for (const row of voteRows) {
    if (row.vote_type === 'player') {
      playerVotes[Number(row.voter_player_id)] = String(row.target_player_id)
    } else if (row.vote_type === 'judge') {
      judgeVote = String(row.target_player_id)
    }
  }

  return {
    playerVotes,
    judgeVote,
  }
}
