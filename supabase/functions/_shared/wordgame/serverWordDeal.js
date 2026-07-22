export const SERVER_NEUTRAL_JUDGE_WORD_FIELD = '__serverNeutralJudgeWord'
export const SERVER_CATALOG_DEAL_VERSION_FIELD = '__serverCatalogDealVersion'

function normalizeExpectedPlayerIds(expectedPlayerIds) {
  if (!Array.isArray(expectedPlayerIds)) {
    return null
  }

  const normalized = expectedPlayerIds.map(Number)
  if (
    normalized.some((playerId) => !Number.isInteger(playerId) || playerId < 0) ||
    new Set(normalized).size !== normalized.length
  ) {
    return null
  }

  return normalized
}

export function buildServerCatalogDeal(wordRows, reservationRows, expectedPlayerIds) {
  const expectedIds = normalizeExpectedPlayerIds(expectedPlayerIds)
  if (!expectedIds || !Array.isArray(wordRows)) {
    return null
  }

  const hasCatalogMarker = wordRows.some(
    (row) =>
      (row?.catalog_word_id !== null && row?.catalog_word_id !== undefined) ||
      (row?.deal_version !== null && row?.deal_version !== undefined),
  )

  if (!hasCatalogMarker) {
    return null
  }

  if (wordRows.length !== expectedIds.length || !Array.isArray(reservationRows) || reservationRows.length !== 1) {
    return null
  }

  const expectedIdSet = new Set(expectedIds)
  const wordsByPlayerId = {}
  const catalogWordIds = new Set()
  let dealVersion = null

  for (const row of wordRows) {
    const playerId = Number(row?.player_id)
    const catalogWordId = Number(row?.catalog_word_id)
    const rowDealVersion = Number(row?.deal_version)
    const word = String(row?.word ?? '').trim().toLowerCase()

    if (
      !expectedIdSet.has(playerId) ||
      !Number.isInteger(catalogWordId) ||
      catalogWordId < 1 ||
      !Number.isInteger(rowDealVersion) ||
      rowDealVersion < 1 ||
      !word ||
      Object.hasOwn(wordsByPlayerId, String(playerId)) ||
      catalogWordIds.has(catalogWordId)
    ) {
      return null
    }

    if (dealVersion === null) {
      dealVersion = rowDealVersion
    } else if (dealVersion !== rowDealVersion) {
      return null
    }

    wordsByPlayerId[String(playerId)] = word
    catalogWordIds.add(catalogWordId)
  }

  const reservation = reservationRows[0]
  const neutralCatalogWordId = Number(reservation?.catalog_word_id)
  const neutralDealVersion = Number(reservation?.deal_version)
  const neutralWord = String(reservation?.word ?? '').trim().toLowerCase()

  if (
    !Number.isInteger(neutralCatalogWordId) ||
    neutralCatalogWordId < 1 ||
    catalogWordIds.has(neutralCatalogWordId) ||
    neutralDealVersion !== dealVersion ||
    !neutralWord ||
    Object.values(wordsByPlayerId).includes(neutralWord)
  ) {
    return null
  }

  return {
    dealVersion,
    wordsByPlayerId,
    neutralWord,
  }
}

export function attachServerCatalogDeal(game, deal) {
  if (!game || !deal?.wordsByPlayerId || !deal.neutralWord) {
    return game
  }

  const hydrated = structuredClone(game)
  hydrated.players = hydrated.players.map((player) => {
    const privateWord = deal.wordsByPlayerId[String(player.id)]

    if (!privateWord) {
      return player
    }

    if (player.holeWord && player.holeWord !== privateWord) {
      throw new Error(`Stored word mismatch for player ${player.id}.`)
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

  hydrated[SERVER_NEUTRAL_JUDGE_WORD_FIELD] = deal.neutralWord
  hydrated[SERVER_CATALOG_DEAL_VERSION_FIELD] = deal.dealVersion
  return hydrated
}

export function removeServerCatalogDeal(game) {
  if (
    !game ||
    (
      !Object.hasOwn(game, SERVER_NEUTRAL_JUDGE_WORD_FIELD) &&
      !Object.hasOwn(game, SERVER_CATALOG_DEAL_VERSION_FIELD)
    )
  ) {
    return game
  }

  const sanitized = { ...game }
  delete sanitized[SERVER_NEUTRAL_JUDGE_WORD_FIELD]
  delete sanitized[SERVER_CATALOG_DEAL_VERSION_FIELD]
  return sanitized
}

export function getServerNeutralJudgeWord(game) {
  const word = game?.[SERVER_NEUTRAL_JUDGE_WORD_FIELD]
  return typeof word === 'string' && word.trim() ? word.trim().toLowerCase() : null
}

export function hasServerCatalogDeal(game) {
  const dealVersion = Number(game?.[SERVER_CATALOG_DEAL_VERSION_FIELD])
  return Number.isInteger(dealVersion) && dealVersion > 0
}
