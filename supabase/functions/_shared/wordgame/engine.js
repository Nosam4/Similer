import matrixData from './matrix.json' with { type: 'json' }

const PHASE_LABELS = {
  preflop: 'Preflop',
  postflop: 'Opening Statements',
  debate: 'Closing Arguments',
  showdownVoting: 'Showdown Voting',
  handComplete: 'Round Complete',
}

const CATEGORY_LABELS = {
  playerVote: 'Player Vote',
  judgeVote: 'Judge Vote',
  similarity: 'Similarity',
}

const ACTIVE_JUDGE_TAX_RATE = 0.2
const FOLDED_JUDGE_TAX_RATE = 0.1
const FALLBACK_PLAYER_NAMES = ['North', 'East', 'South', 'West', 'Alpha', 'Bravo', 'Charlie', 'Delta']

const WORDS = matrixData.words
const SCORES = matrixData.scores
const WORD_INDEX_BY_WORD = new Map(WORDS.map((word, index) => [word, index]))

function deepClone(value) {
  return structuredClone(value)
}

function shuffle(items, rng = Math.random) {
  const copy = [...items]

  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1))
    ;[copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]]
  }

  return copy
}

function nextSeat(players, fromIndex, predicate) {
  const playerCount = players.length

  for (let step = 1; step <= playerCount; step += 1) {
    const index = (fromIndex + step) % playerCount
    if (predicate(players[index])) {
      return index
    }
  }

  return null
}

function countPlayersWithChips(players) {
  return players.filter((player) => player.stack > 0).length
}

function isContender(player) {
  return player.inHand && !player.folded && !player.isJudge
}

function isPlayerVoteVoter(player) {
  return !player.isJudge
}

function getPlayerVoteVoterList(state) {
  return state.players.filter((player) => isPlayerVoteVoter(player))
}

function isActionablePlayer(player) {
  return isContender(player) && !player.allIn && player.stack > 0
}

function countRemainingContenders(state) {
  return state.players.filter((player) => isContender(player)).length
}

function getPotTotal(state) {
  return state.players.reduce((total, player) => total + player.totalCommitted, 0)
}

function buildSidePots(state) {
  const commitmentLevels = [
    ...new Set(
      state.players
        .map((player) => player.totalCommitted)
        .filter((amount) => amount > 0),
    ),
  ].sort((left, right) => left - right)

  let previousLevel = 0

  return commitmentLevels.map((level, index) => {
    const contributionPerPlayer = level - previousLevel
    const contributors = state.players.filter((player) => player.totalCommitted >= level)
    const eligibleContenders = contributors.filter((player) => isContender(player))
    previousLevel = level

    return {
      id: index + 1,
      level,
      contributionPerPlayer,
      amount: contributionPerPlayer * contributors.length,
      contributorIds: contributors.map((player) => player.id),
      eligiblePlayerIds: eligibleContenders.map((player) => player.id),
    }
  })
}

function getPlayerNameById(state, playerId) {
  return state.players.find((player) => player.id === playerId)?.name ?? 'Unknown'
}

function addPayoutToMap(state, payoutByPlayerId, playerId, amount) {
  if (amount <= 0) {
    return
  }

  const player = state.players.find((candidate) => candidate.id === playerId)

  if (!player) {
    throw new Error('Unable to pay chips to an unknown player.')
  }

  player.stack += amount
  payoutByPlayerId.set(playerId, (payoutByPlayerId.get(playerId) ?? 0) + amount)
}

function reserveAmountFromPots(pots, amount, canReserveFromPot) {
  let remaining = amount

  for (let index = pots.length - 1; index >= 0 && remaining > 0; index -= 1) {
    const pot = pots[index]

    if (!canReserveFromPot(pot)) {
      continue
    }

    const reserved = Math.min(pot.amount, remaining)
    pot.amount -= reserved
    pot.reservedAmount += reserved
    remaining -= reserved
  }

  return amount - remaining
}

function reserveJudgePayoutFromPots(pots, judgePlayerId, judgeStakeRefund, judgeBonus) {
  if (judgePlayerId === null || judgeStakeRefund + judgeBonus <= 0) {
    return
  }

  reserveAmountFromPots(
    pots,
    judgeStakeRefund,
    (pot) => pot.contributorIds.includes(judgePlayerId),
  )

  if (judgeBonus > 0) {
    reserveAmountFromPots(
      pots,
      judgeBonus,
      (pot) => pot.contributorIds.includes(judgePlayerId),
    )
  }
}

function getJudgeCoveredPotTotal(state, judgePlayerId) {
  if (judgePlayerId === null || judgePlayerId === undefined) {
    return 0
  }

  return buildSidePots(state)
    .filter((pot) => pot.contributorIds.includes(judgePlayerId))
    .reduce((total, pot) => total + pot.amount, 0)
}

function chooseMainPotWinnerId(pot, rankedPlayerIds) {
  return rankedPlayerIds.find((playerId) => {
    return pot.eligiblePlayerIds.includes(playerId)
  })
}

function getSimilarityScoreForPlayerId(state, playerId) {
  const player = state.players.find((candidate) => candidate.id === playerId)

  if (!player || !state.judgeWord) {
    return Number.NEGATIVE_INFINITY
  }

  return getSimilarityScore(player.holeWord, state.judgeWord)
}

function getSimilarityScoreStatus(player) {
  if (player.isJudge) {
    return 'Judge word benchmark'
  }

  if (player.folded) {
    return 'Folded - not eligible'
  }

  if (isContender(player)) {
    return 'Contender'
  }

  return 'Not eligible'
}

function buildAllSimilarityScores(state) {
  if (!state.judgeWord) {
    return []
  }

  return state.players
    .filter((player) => player.inHand && player.holeWord)
    .map((player) => {
      return {
        playerId: player.id,
        playerName: player.name,
        word: player.holeWord,
        similarity: getSimilarityScore(player.holeWord, state.judgeWord),
        status: getSimilarityScoreStatus(player),
        eligible: isContender(player),
        folded: player.folded,
        isJudge: player.isJudge,
      }
    })
    .sort((left, right) => {
      if (left.isJudge !== right.isJudge) {
        return left.isJudge ? 1 : -1
      }

      return right.similarity - left.similarity
    })
}

function chooseSidePotWinner(state, pot, rankedPlayerIds) {
  if (pot.id === 1) {
    const winnerId = chooseMainPotWinnerId(pot, rankedPlayerIds)

    return {
      winnerId,
      awardRule: 'main-showdown',
      winningSimilarity: getSimilarityScoreForPlayerId(state, winnerId),
    }
  }

  if (pot.eligiblePlayerIds.length === 1) {
    const winnerId = pot.eligiblePlayerIds[0]

    return {
      winnerId,
      awardRule: 'only-eligible',
      winningSimilarity: getSimilarityScoreForPlayerId(state, winnerId),
    }
  }

  if (pot.eligiblePlayerIds.length > 1 && state.judgeWord) {
    const winnerId = rankContenderIdsBy(state, pot.eligiblePlayerIds, (playerId) => {
      return getSimilarityScoreForPlayerId(state, playerId)
    })[0]

    return {
      winnerId,
      awardRule: 'side-pot-similarity',
      winningSimilarity: getSimilarityScoreForPlayerId(state, winnerId),
    }
  }

  const winnerId = chooseMainPotWinnerId(pot, rankedPlayerIds)

  return {
    winnerId,
    awardRule: 'showdown-fallback',
    winningSimilarity: getSimilarityScoreForPlayerId(state, winnerId),
  }
}

function settlePotsByRanking(state, rankedPlayerIds, options = {}) {
  const sidePots = buildSidePots(state).map((pot) => ({
    ...pot,
    originalAmount: pot.amount,
    reservedAmount: 0,
  }))
  const payoutByPlayerId = new Map()
  const sidePotAwards = []

  const {
    judgePlayerId = null,
    judgeStakeRefund = 0,
    judgeBonus = 0,
    judgePayout = 0,
  } = options

  reserveJudgePayoutFromPots(sidePots, judgePlayerId, judgeStakeRefund, judgeBonus)

  if (judgePlayerId !== null && judgePayout > 0) {
    addPayoutToMap(state, payoutByPlayerId, judgePlayerId, judgePayout)
  }

  for (const pot of sidePots) {
    const award = chooseSidePotWinner(state, pot, rankedPlayerIds)
    const winningPlayerId = award.winnerId

    if (pot.amount <= 0) {
      sidePotAwards.push({
        id: pot.id,
        level: pot.level,
        amount: 0,
        originalAmount: pot.originalAmount,
        reservedAmount: pot.reservedAmount,
        winnerId: null,
        winnerName: null,
        eligiblePlayerIds: pot.eligiblePlayerIds,
        awardRule: award.awardRule,
        winningSimilarity: null,
      })
      continue
    }

    if (winningPlayerId !== undefined) {
      addPayoutToMap(state, payoutByPlayerId, winningPlayerId, pot.amount)
      sidePotAwards.push({
        id: pot.id,
        level: pot.level,
        amount: pot.amount,
        originalAmount: pot.originalAmount,
        reservedAmount: pot.reservedAmount,
        winnerId: winningPlayerId,
        winnerName: getPlayerNameById(state, winningPlayerId),
        eligiblePlayerIds: pot.eligiblePlayerIds,
        awardRule: award.awardRule,
        winningSimilarity: award.winningSimilarity,
      })
      continue
    }

    const refundAmountByPlayer = Math.floor(pot.amount / pot.contributorIds.length)
    let oddChipRemainder = pot.amount - refundAmountByPlayer * pot.contributorIds.length

    for (const contributorId of pot.contributorIds) {
      const refund = refundAmountByPlayer + (oddChipRemainder > 0 ? 1 : 0)
      oddChipRemainder = Math.max(0, oddChipRemainder - 1)
      addPayoutToMap(state, payoutByPlayerId, contributorId, refund)
    }

    sidePotAwards.push({
      id: pot.id,
      level: pot.level,
      amount: pot.amount,
      originalAmount: pot.originalAmount,
      reservedAmount: pot.reservedAmount,
      winnerId: null,
      winnerName: 'Returned to contributors',
      eligiblePlayerIds: pot.eligiblePlayerIds,
      awardRule: 'returned',
      winningSimilarity: null,
    })
  }

  const payouts = Array.from(payoutByPlayerId.entries()).map(([playerId, amount]) => ({
    playerId,
    playerName: getPlayerNameById(state, playerId),
    amount,
  }))

  return {
    payouts,
    payoutByPlayerId,
    sidePots: sidePotAwards,
  }
}

function logSidePotAwards(state, settlement) {
  const sidePots = settlement.sidePots ?? []
  const hasSidePot = sidePots.length > 1
  const hasReservedJudgeChips = sidePots.some((pot) => pot.reservedAmount > 0)

  if (!hasSidePot && !hasReservedJudgeChips) {
    return
  }

  const summary = sidePots
    .filter((pot) => pot.originalAmount > 0)
    .map((pot) => {
      const awardText =
        pot.amount > 0
          ? `${pot.amount} to ${pot.winnerName}${formatPotAwardRule(pot)}`
          : 'fully reserved'
      const reserveText =
        pot.reservedAmount > 0 ? `, ${pot.reservedAmount} reserved` : ''

      return `Pot ${pot.id}: ${awardText}${reserveText}`
    })
    .join('; ')

  addLog(state, `Side pots -> ${summary}.`)
}

function formatPotAwardRule(pot) {
  if (pot.awardRule === 'main-showdown') {
    return ' by main showdown result'
  }

  if (pot.awardRule === 'side-pot-similarity') {
    const scoreText = Number.isFinite(pot.winningSimilarity)
      ? ` (${formatLogScore(pot.winningSimilarity)})`
      : ''
    return ` by side-pot similarity${scoreText}`
  }

  if (pot.awardRule === 'only-eligible') {
    return ' as the only eligible contender'
  }

  if (pot.awardRule === 'showdown-fallback') {
    return ' by showdown fallback'
  }

  return ''
}

function addLog(state, message) {
  state.log.push(`[Round ${state.handNumber}] ${message}`)

  if (state.log.length > 250) {
    state.log = state.log.slice(state.log.length - 250)
  }
}

function markTableCompleteIfOnlyOnePlayerHasChips(state) {
  if (state.tableComplete) {
    return
  }

  const playersWithChips = countPlayersWithChips(state.players)

  if (playersWithChips >= 2) {
    return
  }

  state.tableComplete = true

  const winner = state.players.find((player) => player.stack > 0)

  if (winner) {
    addLog(state, `${winner.name} is the only player with chips left.`)
  } else {
    addLog(state, 'No players have chips left.')
  }
}

function commitChips(player, amount) {
  const committed = Math.max(0, Math.min(amount, player.stack))

  player.stack -= committed
  player.betThisStreet += committed
  player.totalCommitted += committed

  if (player.stack === 0 && player.inHand && !player.folded) {
    player.allIn = true
  }

  return committed
}

function getAnteAmount(state) {
  const ante = Number(state.ante)

  if (Number.isFinite(ante) && ante > 0) {
    return Math.floor(ante)
  }

  return state.bigBlind
}

function commitAnte(player, amount) {
  const committed = Math.max(0, Math.min(amount, player.stack))

  player.stack -= committed
  player.totalCommitted += committed

  if (player.stack === 0 && player.inHand && !player.folded) {
    player.allIn = true
  }

  return committed
}

function resetBettingRound(state) {
  state.currentBet = 0
  state.minRaise = state.bigBlind

  for (const player of state.players) {
    player.betThisStreet = 0

    if (isActionablePlayer(player)) {
      player.hasActedThisStreet = false
      player.canRaise = true
    }
  }
}

function findNextActionableIndex(state, fromIndex) {
  return nextSeat(state.players, fromIndex, (player) => isActionablePlayer(player))
}

function getAmountToCall(state, player) {
  return Math.max(0, state.currentBet - player.betThisStreet)
}

function normalizeBetTarget(rawAmount) {
  const value = Number(rawAmount)

  if (!Number.isFinite(value)) {
    return null
  }

  return Math.floor(value)
}

function getContenderList(state) {
  return state.players.filter((player) => isContender(player))
}

function getArgumentPhaseKey(state) {
  if (state.phase === 'postflop') {
    return 'opening'
  }

  if (state.phase === 'debate') {
    return 'closing'
  }

  return null
}

function getArgumentPhaseLabel(phaseKey) {
  return phaseKey === 'opening' ? 'opening statement' : 'closing argument'
}

function ensureArgumentStatus(state) {
  if (!state.argumentStatus || typeof state.argumentStatus !== 'object') {
    state.argumentStatus = {}
  }

  if (!state.argumentStatus.opening || typeof state.argumentStatus.opening !== 'object') {
    state.argumentStatus.opening = {}
  }

  if (!state.argumentStatus.closing || typeof state.argumentStatus.closing !== 'object') {
    state.argumentStatus.closing = {}
  }

  return state.argumentStatus
}

function resetArgumentPhase(state, phaseKey) {
  ensureArgumentStatus(state)[phaseKey] = {}
}

function getRequiredArgumentPlayerIds(state, phaseKey = getArgumentPhaseKey(state)) {
  if (phaseKey !== 'opening' && phaseKey !== 'closing') {
    return []
  }

  return getContenderList(state).map((player) => player.id)
}

function validateArgumentPhase(state, phaseKey) {
  const currentPhaseKey = getArgumentPhaseKey(state)

  if (phaseKey !== currentPhaseKey) {
    throw new Error('Arguments can only be marked during the active argument phase.')
  }
}

function hasPlayerCompletedArgument(state, playerId, phaseKey) {
  const status = ensureArgumentStatus(state)[phaseKey] ?? {}
  return Boolean(status[String(playerId)])
}

function areArgumentsComplete(state, phaseKey) {
  const requiredPlayerIds = getRequiredArgumentPlayerIds(state, phaseKey)

  return requiredPlayerIds.every((playerId) => {
    return hasPlayerCompletedArgument(state, playerId, phaseKey)
  })
}

function markArgumentInPlace(state, playerId, phaseKey) {
  validateArgumentPhase(state, phaseKey)

  const numericPlayerId = Number(playerId)
  const requiredPlayerIds = getRequiredArgumentPlayerIds(state, phaseKey)

  if (!requiredPlayerIds.includes(numericPlayerId)) {
    throw new Error('Only active contenders need to mark arguments.')
  }

  const status = ensureArgumentStatus(state)[phaseKey]

  if (status[String(numericPlayerId)]) {
    return false
  }

  status[String(numericPlayerId)] = true
  addLog(
    state,
    `${getPlayerNameById(state, numericPlayerId)} finished their ${getArgumentPhaseLabel(phaseKey)}.`,
  )

  return true
}

function forceCompleteArgumentsInPlace(state, phaseKey) {
  validateArgumentPhase(state, phaseKey)

  const status = ensureArgumentStatus(state)[phaseKey]

  for (const playerId of getRequiredArgumentPlayerIds(state, phaseKey)) {
    status[String(playerId)] = true
  }

  addLog(state, `${phaseKey === 'opening' ? 'Opening statements' : 'Closing arguments'} were advanced by table control.`)
}

function advanceIfOpeningArgumentsComplete(state) {
  if (state.phase === 'postflop' && state.currentPlayerIndex === null && areArgumentsComplete(state, 'opening')) {
    return moveToDebateStage(state)
  }

  return state
}

function getSeatIndexByPlayerId(state) {
  const lookup = new Map()

  for (let index = 0; index < state.players.length; index += 1) {
    lookup.set(state.players[index].id, index)
  }

  return lookup
}

function getSimilarityScore(playerWord, judgeWord) {
  const playerWordIndex = WORD_INDEX_BY_WORD.get(playerWord)
  const judgeWordIndex = WORD_INDEX_BY_WORD.get(judgeWord)

  if (playerWordIndex === undefined || judgeWordIndex === undefined) {
    return Number.NEGATIVE_INFINITY
  }

  return SCORES[playerWordIndex]?.[judgeWordIndex] ?? Number.NEGATIVE_INFINITY
}

function formatLogScore(score) {
  return Number.isFinite(score) ? score.toFixed(2) : '--'
}

function drawNeutralJudgeWord(state, rng = Math.random) {
  const usedWords = new Set(
    state.players.map((player) => player.holeWord).filter((word) => word),
  )
  const availableWords = WORDS.filter((word) => !usedWords.has(word))
  const pool = availableWords.length > 0 ? availableWords : WORDS

  return pool[Math.floor(rng() * pool.length)]
}

function toCategoryLabel(categoryKey) {
  return CATEGORY_LABELS[categoryKey] ?? categoryKey
}

function formatCategoryList(categories) {
  const labels = categories.map((category) => toCategoryLabel(category))

  if (labels.length === 0) {
    return 'no categories'
  }

  if (labels.length === 1) {
    return labels[0]
  }

  if (labels.length === 2) {
    return `${labels[0]} and ${labels[1]}`
  }

  return `${labels.slice(0, -1).join(', ')}, and ${labels[labels.length - 1]}`
}

function buildWinnerExplanation(resolution, winner) {
  const winnerCategories = resolution.categoryWinsByPlayerId.get(winner.id) ?? []

  if (resolution.winnerReason === 'two-of-three-or-better') {
    if (winnerCategories.length === 3) {
      return `${winner.name} sweeps all 3 categories (${formatCategoryList(winnerCategories)}).`
    }

    return `${winner.name} wins 2-1 by taking ${formatCategoryList(winnerCategories)}.`
  }

  if (resolution.winnerReason === 'three-way-category-split-similarity-tiebreak') {
    return `Three-way category split. Similarity breaks the tie, so ${winner.name} wins.`
  }

  if (resolution.winnerReason === 'category-tie-similarity-tiebreak') {
    return `Category wins were tied, so similarity breaks the tie in favor of ${winner.name}.`
  }

  return `${winner.name} had the strongest category result and wins.`
}

function buildNeutralVotingExplanation(resolution, winner) {
  if (resolution.winnerReason === 'player-vote-and-similarity') {
    return `${winner.name} wins clearly: Player Vote reached a majority, and Similarity agreed.`
  }

  if (resolution.winnerReason === 'neutral-clear-player-vote-majority') {
    return `${winner.name} wins by clear Player Vote majority; Similarity only decides neutral voting when there is no majority.`
  }

  if (resolution.winnerReason === 'neutral-no-majority-similarity') {
    return `No word received a clear Player Vote majority, so Similarity decides in favor of ${winner.name}.`
  }

  return `${winner.name} wins the neutral showdown.`
}

function makeFreshPlayer(id, name, stack) {
  return {
    id,
    name,
    stack,
    inHand: stack > 0,
    folded: false,
    allIn: false,
    isJudge: false,
    holeWord: null,
    betThisStreet: 0,
    totalCommitted: 0,
    hasActedThisStreet: false,
    canRaise: true,
    lastAction: null,
  }
}

function settleUncontestedPot(state) {
  const contenders = getContenderList(state)
  const winner = contenders[0]

  if (!winner) {
    throw new Error('No contender available for uncontested pot resolution.')
  }

  const judge = getJudgePlayerFromState(state)
  const judgeStakeRefund = judge && !judge.folded ? judge.totalCommitted : 0
  const settlement = settlePotsByRanking(state, [winner.id], {
    judgePlayerId: judge?.id ?? null,
    judgeStakeRefund,
    judgeBonus: 0,
    judgePayout: judgeStakeRefund,
  })
  const potAmount = settlement.payoutByPlayerId.get(winner.id) ?? 0

  state.showdown = {
    type: 'uncontested',
    winnerId: winner.id,
    winnerName: winner.name,
    winnerWord: winner.holeWord,
    amount: potAmount,
    judge: judge
      ? {
          playerId: judge.id,
          playerName: judge.name,
          contribution: judge.totalCommitted,
          stakeRefund: judgeStakeRefund,
          bonus: 0,
          taxRate: judge.folded ? FOLDED_JUDGE_TAX_RATE : ACTIVE_JUDGE_TAX_RATE,
          payout: judgeStakeRefund,
          wasFolded: judge.folded,
        }
      : null,
    payouts: settlement.payouts,
    sidePots: settlement.sidePots,
    allSimilarityScores: buildAllSimilarityScores(state),
  }

  state.handComplete = true
  state.phase = 'handComplete'
  state.currentPlayerIndex = null

  logSidePotAwards(state, settlement)
  if (judge && judgeStakeRefund > 0) {
    addLog(
      state,
      `${judge.name} receives stake refund ${judgeStakeRefund}; no Judge Tax is awarded because the round ended uncontested.`,
    )
  }
  addLog(state, `${winner.name} wins ${potAmount} chips uncontested.`)
  markTableCompleteIfOnlyOnePlayerHasChips(state)

  return state
}

function shouldUseFinalDuel(state) {
  const foldedJudgeCandidates = state.players.filter((player) => player.inHand && player.folded)

  return countRemainingContenders(state) === 2 && foldedJudgeCandidates.length === 0
}

function hasAllInContender(state) {
  return getContenderList(state).some((player) => player.allIn)
}

function isBettingRoundComplete(state) {
  const contenders = getContenderList(state)
  const actionable = contenders.filter((player) => !player.allIn)

  if (actionable.length === 0) {
    return true
  }

  return actionable.every((player) => {
    return player.hasActedThisStreet && player.betThisStreet === state.currentBet
  })
}

function chooseJudgeIndex(state) {
  const activeContenderIndexes = []
  const fallbackJudgeIndexes = []

  for (let index = 0; index < state.players.length; index += 1) {
    const player = state.players[index]
    if (!player.inHand) {
      continue
    }

    if (player.folded) {
      fallbackJudgeIndexes.push(index)
    } else {
      activeContenderIndexes.push(index)
    }
  }

  const eligibleJudgeIndexes =
    activeContenderIndexes.length >= 3 || fallbackJudgeIndexes.length === 0
      ? activeContenderIndexes
      : fallbackJudgeIndexes

  if (eligibleJudgeIndexes.length === 0) {
    return null
  }

  const randomPick = Math.floor(Math.random() * eligibleJudgeIndexes.length)
  return eligibleJudgeIndexes[randomPick]
}

function chooseFoldedJudgeIndex(state) {
  const foldedJudgeIndexes = []

  for (let index = 0; index < state.players.length; index += 1) {
    const player = state.players[index]

    if (player.inHand && player.folded) {
      foldedJudgeIndexes.push(index)
    }
  }

  if (foldedJudgeIndexes.length === 0) {
    return null
  }

  const randomPick = Math.floor(Math.random() * foldedJudgeIndexes.length)
  return foldedJudgeIndexes[randomPick]
}

function resolveSimilarityDuel(state) {
  if (countRemainingContenders(state) <= 1) {
    return settleUncontestedPot(state)
  }

  if (!state.judgeWord) {
    throw new Error('Cannot resolve Final Duel without a neutral judge word.')
  }

  const contenders = getContenderList(state)
  const contenderIds = contenders.map((player) => player.id)
  const similarityByPlayerId = new Map()

  for (const contender of contenders) {
    similarityByPlayerId.set(
      contender.id,
      getSimilarityScore(contender.holeWord, state.judgeWord),
    )
  }

  const winnerId = rankContenderIdsBy(state, contenderIds, (playerId) => {
    return similarityByPlayerId.get(playerId) ?? Number.NEGATIVE_INFINITY
  })[0]
  const winner = state.players.find((player) => player.id === winnerId)

  if (!winner) {
    throw new Error('Unable to find final duel winner.')
  }

  const rankedPlayerIds = rankContenderIdsBy(state, contenderIds, (playerId) => {
    return similarityByPlayerId.get(playerId) ?? Number.NEGATIVE_INFINITY
  })
  const settlement = settlePotsByRanking(state, rankedPlayerIds)
  const potAmount = settlement.payoutByPlayerId.get(winner.id) ?? 0

  state.showdown = {
    type: 'similarityDuel',
    judgeWord: state.judgeWord,
    contenders: contenders.map((player) => {
      return {
        playerId: player.id,
        playerName: player.name,
        word: player.holeWord,
        similarity: similarityByPlayerId.get(player.id),
      }
    }),
    categories: {
      similarityWinnerId: winner.id,
    },
    winner: {
      playerId: winner.id,
      playerName: winner.name,
      word: winner.holeWord,
      reason: 'similarity-duel',
      payout: potAmount,
    },
    payouts: settlement.payouts,
    sidePots: settlement.sidePots,
    allSimilarityScores: buildAllSimilarityScores(state),
  }

  addLog(
    state,
    `Final Duel similarity -> ${contenders
      .map((player) => {
        const score = similarityByPlayerId.get(player.id)
        return `${player.name}: ${formatLogScore(score)}`
      })
      .join(', ')}.`,
  )
  addLog(
    state,
    `Winner logic -> Final Duel uses the neutral judge word "${state.judgeWord}". ${winner.name} is closest by similarity.`,
  )
  logSidePotAwards(state, settlement)
  addLog(state, `${winner.name} wins the round for ${potAmount}.`)

  state.handComplete = true
  state.phase = 'handComplete'
  state.currentPlayerIndex = null
  markTableCompleteIfOnlyOnePlayerHasChips(state)

  return state
}

function moveToShowdownVoting(state) {
  if (countRemainingContenders(state) <= 1) {
    return settleUncontestedPot(state)
  }

  const judge = getJudgePlayerFromState(state)

  if (!judge) {
    if (state.showdownMode === 'similarityDuel') {
      return resolveSimilarityDuel(state)
    }

    if (state.showdownMode !== 'neutralVoting') {
      throw new Error('Cannot begin showdown voting without an assigned judge.')
    }
  }

  state.phase = 'showdownVoting'
  state.currentPlayerIndex = null

  if (!judge) {
    addLog(
      state,
      'Showdown voting begins with a neutral judge word. The table votes; a clear Player Vote majority wins, otherwise Similarity decides.',
    )
    return state
  }

  addLog(
    state,
    `Showdown voting begins. Judge ${judge.name} votes with the table and similarity score decides the third category.`,
  )

  return state
}

function moveToDebateStage(state) {
  if (countRemainingContenders(state) <= 1) {
    return settleUncontestedPot(state)
  }

  state.phase = 'debate'
  state.currentPlayerIndex = null
  resetArgumentPhase(state, 'closing')

  if (state.showdownMode === 'similarityDuel') {
    addLog(
      state,
      `Closing arguments begin. Final Duel words are revealed against neutral judge word "${state.judgeWord}". Similarity will decide the winner after arguments.`,
    )
  } else if (state.showdownMode === 'neutralVoting') {
    addLog(
      state,
      `Closing arguments begin. Neutral judge word "${state.judgeWord}" is live because all-in contenders are protected. The table votes; a clear Player Vote majority wins, otherwise Similarity decides.`,
    )
  } else {
    addLog(
      state,
      `Closing arguments begin. Contenders reveal their assigned words and argue closest connection to "${state.judgeWord}" before voting.`,
    )
  }

  return state
}

function startNeutralJudgePhase(state, showdownMode) {
  state.judgePlayerId = null
  state.judgeWord = drawNeutralJudgeWord(state)
  state.showdownMode = showdownMode
  state.phase = 'postflop'
  resetArgumentPhase(state, 'opening')

  resetBettingRound(state)

  if (showdownMode === 'similarityDuel') {
    addLog(
      state,
      `Final Duel begins. Neutral judge word: "${state.judgeWord}". Both players stay active; no judge vote will be used.`,
    )
  } else {
    addLog(
      state,
      `All-in protection uses neutral judge word "${state.judgeWord}". All contenders stay eligible; no judge vote will be used.`,
    )
  }

  state.currentPlayerIndex = findNextActionableIndex(state, state.dealerIndex)

  if (state.currentPlayerIndex === null) {
    return advanceIfOpeningArgumentsComplete(state)
  }

  return state
}

function startPostflopJudgePhase(state) {
  const remainingContenderCount = countRemainingContenders(state)

  if (remainingContenderCount <= 1) {
    return settleUncontestedPot(state)
  }

  if (hasAllInContender(state)) {
    const foldedJudgeIndex = chooseFoldedJudgeIndex(state)

    if (foldedJudgeIndex !== null) {
      return startPlayerJudgePhase(
        state,
        foldedJudgeIndex,
        'All-in protection selects a folded player as judge so all-in contenders stay eligible.',
      )
    }

    const neutralMode = remainingContenderCount === 2 ? 'similarityDuel' : 'neutralVoting'
    return startNeutralJudgePhase(state, neutralMode)
  }

  if (shouldUseFinalDuel(state)) {
    return startNeutralJudgePhase(state, 'similarityDuel')
  }

  const judgeIndex = chooseJudgeIndex(state)

  if (judgeIndex === null) {
    throw new Error('Unable to choose a judge for this round.')
  }

  return startPlayerJudgePhase(state, judgeIndex)
}

function startPlayerJudgePhase(state, judgeIndex, reason = null) {
  const judge = state.players[judgeIndex]
  judge.isJudge = true
  judge.hasActedThisStreet = true
  judge.canRaise = false

  state.judgePlayerId = judge.id
  state.judgeWord = judge.holeWord
  state.phase = 'postflop'
  resetArgumentPhase(state, 'opening')

  resetBettingRound(state)

  addLog(
    state,
    `${judge.name} becomes the judge. Judge word: "${state.judgeWord}". Active judges receive a stake refund when the round ends; correct active judges can earn 20% Judge Tax from covered pot layers, while correct folded judges can earn 10% without a stake refund. Judges cannot tax side pots above their committed stake.`,
  )
  if (reason) {
    addLog(state, reason)
  }

  if (countRemainingContenders(state) <= 1) {
    return settleUncontestedPot(state)
  }

  state.currentPlayerIndex = findNextActionableIndex(state, state.dealerIndex)

  if (state.currentPlayerIndex === null) {
    return advanceIfOpeningArgumentsComplete(state)
  }

  return state
}

function advanceAfterCompletedBettingRound(state) {
  if (state.phase === 'preflop') {
    return startPostflopJudgePhase(state)
  }

  if (state.phase === 'postflop') {
    if (!areArgumentsComplete(state, 'opening')) {
      state.currentPlayerIndex = null
      return state
    }

    return moveToDebateStage(state)
  }

  return state
}

function applyPostActionState(state, actorIndex) {
  if (countRemainingContenders(state) === 1) {
    return settleUncontestedPot(state)
  }

  if (isBettingRoundComplete(state)) {
    return advanceAfterCompletedBettingRound(state)
  }

  const nextActor = findNextActionableIndex(state, actorIndex)

  if (nextActor === null) {
    return advanceAfterCompletedBettingRound(state)
  }

  state.currentPlayerIndex = nextActor

  return state
}

function markFullRaise(state, actorIndex, raiseSize) {
  state.minRaise = raiseSize

  for (let index = 0; index < state.players.length; index += 1) {
    const player = state.players[index]
    if (isActionablePlayer(player)) {
      player.hasActedThisStreet = false
      player.canRaise = true
    }
  }

  state.players[actorIndex].hasActedThisStreet = true
  state.players[actorIndex].canRaise = true
}

function markShortRaise(state, actorIndex) {
  const actor = state.players[actorIndex]
  actor.hasActedThisStreet = true

  for (let index = 0; index < state.players.length; index += 1) {
    if (index === actorIndex) {
      continue
    }

    const player = state.players[index]

    if (!isActionablePlayer(player)) {
      continue
    }

    if (player.hasActedThisStreet) {
      player.canRaise = false
    }
  }
}

function ensureCanAct(state) {
  if (state.handComplete || state.tableComplete) {
    throw new Error('The current round is already complete.')
  }

  if (state.currentPlayerIndex === null) {
    throw new Error('No active player can act right now.')
  }

  const player = state.players[state.currentPlayerIndex]

  if (!isActionablePlayer(player)) {
    throw new Error('Current player cannot act.')
  }

  return player
}

function applyFold(state, player) {
  player.folded = true
  player.hasActedThisStreet = true
  player.lastAction = 'fold'

  addLog(state, `${player.name} folds.`)
}

function applyCheck(state, player) {
  const toCall = getAmountToCall(state, player)

  if (toCall !== 0) {
    throw new Error('Cannot check while facing a bet.')
  }

  player.hasActedThisStreet = true
  player.lastAction = 'check'

  addLog(state, `${player.name} checks.`)
}

function applyCall(state, player) {
  const toCall = getAmountToCall(state, player)

  if (toCall <= 0) {
    throw new Error('No chips are needed to call.')
  }

  const committed = commitChips(player, toCall)
  player.hasActedThisStreet = true
  player.lastAction = player.allIn ? 'all-in call' : 'call'

  if (committed < toCall) {
    addLog(state, `${player.name} calls all-in for ${committed}.`)
  } else {
    addLog(state, `${player.name} calls ${committed}.`)
  }
}

function applyBet(state, player, actorIndex, rawAmount) {
  const toCall = getAmountToCall(state, player)

  if (toCall !== 0) {
    throw new Error('Cannot bet while facing a bet. Use raise instead.')
  }

  if (!player.canRaise) {
    throw new Error('Betting is not reopened for this player.')
  }

  const maxTarget = player.betThisStreet + player.stack
  const target = normalizeBetTarget(rawAmount)

  if (target === null) {
    throw new Error('Enter a valid bet amount.')
  }

  if (target <= player.betThisStreet) {
    throw new Error('Bet amount must be greater than the current contribution.')
  }

  if (target > maxTarget) {
    throw new Error('Bet exceeds the available stack.')
  }

  const openingSize = target - player.betThisStreet
  const isAllIn = target === maxTarget
  const isFullRaise = openingSize >= state.bigBlind

  if (!isFullRaise && !isAllIn) {
    throw new Error(`Minimum opening bet is ${state.bigBlind}, unless all-in.`)
  }

  commitChips(player, openingSize)
  state.currentBet = player.betThisStreet

  if (isFullRaise) {
    markFullRaise(state, actorIndex, openingSize)
    player.lastAction = 'bet'
  } else {
    markShortRaise(state, actorIndex)
    player.lastAction = 'all-in bet'
  }

  addLog(
    state,
    `${player.name} ${player.allIn ? 'bets all-in' : 'bets'} to ${state.currentBet}.`,
  )
}

function applyRaise(state, player, actorIndex, rawAmount) {
  const toCall = getAmountToCall(state, player)

  if (toCall <= 0) {
    throw new Error('No bet to raise. Use bet instead.')
  }

  if (!player.canRaise) {
    throw new Error('Raising is not reopened for this player.')
  }

  const maxTarget = player.betThisStreet + player.stack
  const target = normalizeBetTarget(rawAmount)

  if (target === null) {
    throw new Error('Enter a valid raise amount.')
  }

  if (target <= state.currentBet) {
    throw new Error('Raise target must exceed the current bet.')
  }

  if (target > maxTarget) {
    throw new Error('Raise exceeds the available stack.')
  }

  const raiseSize = target - state.currentBet
  const isAllIn = target === maxTarget
  const isFullRaise = raiseSize >= state.minRaise

  if (!isFullRaise && !isAllIn) {
    throw new Error(
      `Minimum raise is to ${state.currentBet + state.minRaise}, unless all-in.`,
    )
  }

  const additionalChips = target - player.betThisStreet
  commitChips(player, additionalChips)
  state.currentBet = player.betThisStreet

  if (isFullRaise) {
    markFullRaise(state, actorIndex, raiseSize)
    player.lastAction = 'raise'
  } else {
    markShortRaise(state, actorIndex)
    player.lastAction = 'all-in raise'
  }

  addLog(
    state,
    `${player.name} ${player.allIn ? 'raises all-in' : 'raises'} to ${state.currentBet}.`,
  )
}

function applyAllIn(state, player, actorIndex) {
  if (player.stack <= 0) {
    throw new Error('Player has no chips left to go all-in.')
  }

  const toCall = getAmountToCall(state, player)
  const target = player.betThisStreet + player.stack

  if (target <= state.currentBet) {
    const committed = commitChips(player, player.stack)
    player.hasActedThisStreet = true
    player.lastAction = 'all-in call'

    if (toCall > 0) {
      addLog(state, `${player.name} calls all-in for ${committed}.`)
    } else {
      addLog(state, `${player.name} is all-in for ${committed}.`)
    }

    return
  }

  if (!player.canRaise) {
    throw new Error('Raising is not reopened for this player.')
  }

  const raiseSize = target - state.currentBet
  const isFullRaise = raiseSize >= state.minRaise

  commitChips(player, player.stack)
  state.currentBet = player.betThisStreet

  if (state.currentBet === raiseSize) {
    if (isFullRaise) {
      markFullRaise(state, actorIndex, raiseSize)
      player.lastAction = 'all-in bet'
    } else {
      markShortRaise(state, actorIndex)
      player.lastAction = 'all-in bet'
    }
  } else if (isFullRaise) {
    markFullRaise(state, actorIndex, raiseSize)
    player.lastAction = 'all-in raise'
  } else {
    markShortRaise(state, actorIndex)
    player.lastAction = 'all-in raise'
  }

  addLog(state, `${player.name} moves all-in to ${state.currentBet}.`)
}

function setUpNewHand(state, rng = Math.random) {
  state.handNumber += 1
  state.phase = 'preflop'
  state.handComplete = false
  state.tableComplete = false
  state.currentPlayerIndex = null
  state.currentBet = 0
  state.minRaise = state.bigBlind
  state.ante = getAnteAmount(state)
  state.judgePlayerId = null
  state.judgeWord = null
  state.showdownMode = null
  state.showdown = null
  state.argumentStatus = {
    opening: {},
    closing: {},
  }

  for (const player of state.players) {
    player.inHand = player.stack > 0
    player.folded = !player.inHand
    player.allIn = false
    player.isJudge = false
    player.holeWord = null
    player.betThisStreet = 0
    player.totalCommitted = 0
    player.hasActedThisStreet = false
    player.canRaise = true
    player.lastAction = null
  }

  state.smallBlindIndex = null
  state.bigBlindIndex = null

  const playersWithChips = countPlayersWithChips(state.players)

  if (playersWithChips < 2) {
    state.handComplete = true
    state.tableComplete = true
    state.phase = 'handComplete'

    const winner = state.players.find((player) => player.stack > 0)
    if (winner) {
      addLog(state, `${winner.name} is the only player with chips left.`)
    } else {
      addLog(state, 'No players have chips left.')
    }

    return state
  }

  const dealerStartIndex = state.dealerIndex === -1 ? state.players.length - 1 : state.dealerIndex
  const dealerIndex = nextSeat(state.players, dealerStartIndex, (player) => player.stack > 0)
  state.dealerIndex = dealerIndex

  const preflopFirstActor = nextSeat(state.players, dealerIndex, (player) => player.inHand)

  const shuffledWords = shuffle(WORDS, rng)
  let wordCursor = 0

  for (const player of state.players) {
    if (player.inHand) {
      player.holeWord = shuffledWords[wordCursor]
      wordCursor += 1
    }
  }

  for (const player of state.players) {
    if (!player.inHand) {
      continue
    }

    const postedAnte = commitAnte(player, state.ante)
    addLog(state, `${player.name} antes ${postedAnte}${player.allIn ? ' (all-in)' : ''}.`)
  }

  state.currentBet = 0
  state.minRaise = state.bigBlind

  addLog(
    state,
    `Words dealt. Dealer: ${state.players[dealerIndex].name}. Each active player antes ${state.ante}. Betting starts in preflop.`,
  )

  state.currentPlayerIndex = findNextActionableIndex(state, preflopFirstActor - 1)

  if (state.currentPlayerIndex === null) {
    return advanceAfterCompletedBettingRound(state)
  }

  return state
}

function rankContenderIdsBy(state, contenderIds, scoreFn) {
  const seatByPlayerId = getSeatIndexByPlayerId(state)

  return [...contenderIds].sort((leftId, rightId) => {
    const scoreDiff = scoreFn(rightId) - scoreFn(leftId)
    if (scoreDiff !== 0) {
      return scoreDiff
    }

    return (seatByPlayerId.get(leftId) ?? 0) - (seatByPlayerId.get(rightId) ?? 0)
  })
}

function buildVotingResolution(state, playerVotes, judgeVote) {
  const contenders = getContenderList(state)
  const playerVoteVoters = getPlayerVoteVoterList(state)
  const contenderIds = contenders.map((player) => player.id)
  const contenderIdSet = new Set(contenderIds)

  const voteCountByPlayerId = new Map(contenderIds.map((id) => [id, 0]))

  for (const voter of playerVoteVoters) {
    const voteTargetId = Number(playerVotes[voter.id])

    if (!contenderIdSet.has(voteTargetId)) {
      throw new Error(`Invalid vote target selected by ${voter.name}.`)
    }

    if (voteTargetId === voter.id) {
      throw new Error(`${voter.name} cannot vote for their own word.`)
    }

    voteCountByPlayerId.set(voteTargetId, (voteCountByPlayerId.get(voteTargetId) ?? 0) + 1)
  }

  const normalizedJudgeVote = Number(judgeVote)

  if (!contenderIdSet.has(normalizedJudgeVote)) {
    throw new Error('Judge vote must target an active contender.')
  }

  const similarityByPlayerId = new Map()

  for (const contender of contenders) {
    similarityByPlayerId.set(
      contender.id,
      getSimilarityScore(contender.holeWord, state.judgeWord),
    )
  }

  const maxPlayerVoteCount = Math.max(...Array.from(voteCountByPlayerId.values()))
  const playerVoteLeaderIds = contenderIds.filter((playerId) => {
    return (voteCountByPlayerId.get(playerId) ?? 0) === maxPlayerVoteCount
  })

  const playerVoteWinner = rankContenderIdsBy(state, contenderIds, (playerId) => {
    const votes = voteCountByPlayerId.get(playerId) ?? 0
    const similarity = similarityByPlayerId.get(playerId) ?? Number.NEGATIVE_INFINITY
    return votes * 1000 + similarity
  })[0]

  const similarityWinner = rankContenderIdsBy(state, contenderIds, (playerId) => {
    const similarity = similarityByPlayerId.get(playerId) ?? Number.NEGATIVE_INFINITY
    const votes = voteCountByPlayerId.get(playerId) ?? 0
    const judgeEdge = playerId === normalizedJudgeVote ? 0.0001 : 0
    return similarity * 1000 + votes + judgeEdge
  })[0]

  const judgeVoteWinner = normalizedJudgeVote

  const categoryWinsByPlayerId = new Map(contenderIds.map((id) => [id, []]))
  categoryWinsByPlayerId.get(playerVoteWinner).push('playerVote')
  categoryWinsByPlayerId.get(judgeVoteWinner).push('judgeVote')
  categoryWinsByPlayerId.get(similarityWinner).push('similarity')

  const rankedByCategoryWins = rankContenderIdsBy(state, contenderIds, (playerId) => {
    const wins = categoryWinsByPlayerId.get(playerId).length
    const similarity = similarityByPlayerId.get(playerId) ?? Number.NEGATIVE_INFINITY
    return wins * 1000 + similarity
  })

  const maxWinCount = categoryWinsByPlayerId.get(rankedByCategoryWins[0]).length
  const topPlayers = rankedByCategoryWins.filter((playerId) => {
    return categoryWinsByPlayerId.get(playerId).length === maxWinCount
  })

  let winnerId = rankedByCategoryWins[0]
  let winnerReason = 'highest-category-wins'

  if (maxWinCount >= 2 && topPlayers.length === 1) {
    winnerId = topPlayers[0]
    winnerReason = 'two-of-three-or-better'
  } else if (maxWinCount === 1 && topPlayers.length >= 3) {
    winnerId = similarityWinner
    winnerReason = 'three-way-category-split-similarity-tiebreak'
  } else if (topPlayers.length > 1) {
    winnerId = rankContenderIdsBy(state, topPlayers, (playerId) => {
      const similarity = similarityByPlayerId.get(playerId) ?? Number.NEGATIVE_INFINITY
      const votes = voteCountByPlayerId.get(playerId) ?? 0
      const judgeEdge = playerId === judgeVoteWinner ? 0.0001 : 0
      return similarity * 1000 + votes + judgeEdge
    })[0]
    winnerReason = 'category-tie-similarity-tiebreak'
  }

  const rankedByShowdownStrength = rankContenderIdsBy(state, contenderIds, (playerId) => {
    const categoryWinCount = categoryWinsByPlayerId.get(playerId).length
    const similarity = similarityByPlayerId.get(playerId) ?? Number.NEGATIVE_INFINITY
    const votes = voteCountByPlayerId.get(playerId) ?? 0
    const judgeEdge = playerId === judgeVoteWinner ? 0.0001 : 0

    return categoryWinCount * 1000000 + similarity * 1000 + votes + judgeEdge
  })
  const rankedPlayerIds = [
    winnerId,
    ...rankedByShowdownStrength.filter((playerId) => playerId !== winnerId),
  ]

  return {
    contenders,
    playerVoteVoters,
    winnerId,
    winnerReason,
    rankedPlayerIds,
    playerVoteWinner,
    judgeVoteWinner,
    similarityWinner,
    voteCountByPlayerId,
    similarityByPlayerId,
    categoryWinsByPlayerId,
    playerVoteTieBrokenBySimilarity: playerVoteLeaderIds.length > 1,
  }
}

function buildNeutralVotingResolution(state, playerVotes) {
  const contenders = getContenderList(state)
  const playerVoteVoters = getPlayerVoteVoterList(state)
  const contenderIds = contenders.map((player) => player.id)
  const contenderIdSet = new Set(contenderIds)

  const voteCountByPlayerId = new Map(contenderIds.map((id) => [id, 0]))

  for (const voter of playerVoteVoters) {
    const voteTargetId = Number(playerVotes[voter.id])

    if (!contenderIdSet.has(voteTargetId)) {
      throw new Error(`Invalid vote target selected by ${voter.name}.`)
    }

    if (voteTargetId === voter.id) {
      throw new Error(`${voter.name} cannot vote for their own word.`)
    }

    voteCountByPlayerId.set(voteTargetId, (voteCountByPlayerId.get(voteTargetId) ?? 0) + 1)
  }

  const similarityByPlayerId = new Map()

  for (const contender of contenders) {
    similarityByPlayerId.set(
      contender.id,
      getSimilarityScore(contender.holeWord, state.judgeWord),
    )
  }

  const playerVoteWinner = rankContenderIdsBy(state, contenderIds, (playerId) => {
    const votes = voteCountByPlayerId.get(playerId) ?? 0
    const similarity = similarityByPlayerId.get(playerId) ?? Number.NEGATIVE_INFINITY
    return votes * 1000 + similarity
  })[0]

  const maxVoteCount = Math.max(...Array.from(voteCountByPlayerId.values()))
  const topVotePlayerIds = contenderIds.filter((playerId) => {
    return (voteCountByPlayerId.get(playerId) ?? 0) === maxVoteCount
  })
  const clearMajorityWinner =
    topVotePlayerIds.length === 1 && maxVoteCount > playerVoteVoters.length / 2
      ? topVotePlayerIds[0]
      : null

  const similarityWinner = rankContenderIdsBy(state, contenderIds, (playerId) => {
    const similarity = similarityByPlayerId.get(playerId) ?? Number.NEGATIVE_INFINITY
    const votes = voteCountByPlayerId.get(playerId) ?? 0
    return similarity * 1000 + votes
  })[0]

  const categoryWinsByPlayerId = new Map(contenderIds.map((id) => [id, []]))
  if (clearMajorityWinner !== null) {
    categoryWinsByPlayerId.get(clearMajorityWinner).push('playerVote')
  }
  categoryWinsByPlayerId.get(similarityWinner).push('similarity')

  const winnerId = clearMajorityWinner ?? similarityWinner
  let winnerReason = 'neutral-no-majority-similarity'

  if (clearMajorityWinner !== null) {
    winnerReason =
      clearMajorityWinner === similarityWinner
        ? 'player-vote-and-similarity'
        : 'neutral-clear-player-vote-majority'
  }

  const rankedByNeutralStrength = rankContenderIdsBy(state, contenderIds, (playerId) => {
    const majorityEdge = playerId === clearMajorityWinner ? 1000000 : 0
    const similarity = similarityByPlayerId.get(playerId) ?? Number.NEGATIVE_INFINITY
    const votes = voteCountByPlayerId.get(playerId) ?? 0

    return majorityEdge + similarity * 1000 + votes
  })
  const rankedPlayerIds = [
    winnerId,
    ...rankedByNeutralStrength.filter((playerId) => playerId !== winnerId),
  ]

  return {
    contenders,
    playerVoteVoters,
    winnerId,
    winnerReason,
    rankedPlayerIds,
    playerVoteWinner: clearMajorityWinner,
    voteLeader: playerVoteWinner,
    similarityWinner,
    voteCountByPlayerId,
    similarityByPlayerId,
    categoryWinsByPlayerId,
  }
}

function getJudgePlayerFromState(state) {
  if (state.judgePlayerId === null) {
    return null
  }

  return state.players.find((player) => player.id === state.judgePlayerId) ?? null
}

function sanitizePlayerName(name, index = 0) {
  const cleanName = String(name ?? '')
    .replace(/[^a-z]/gi, '')
    .slice(0, 8)

  return cleanName || FALLBACK_PLAYER_NAMES[index] || 'Player'
}

export function createInitialGame(options = {}) {
  const {
    playerNames = ['North', 'East', 'South', 'West'],
    startingStack = 400,
    bigBlind = 10,
    ante = bigBlind,
    rng = Math.random,
  } = options

  const cleanNames = playerNames
    .map((name, index) => sanitizePlayerName(name, index))
    .slice(0, 8)

  const finalNames = cleanNames.length >= 3 ? cleanNames : ['North', 'East', 'South', 'West']

  const players = finalNames.map((name, index) => makeFreshPlayer(index, name, startingStack))

  const state = {
    handNumber: 0,
    dealerIndex: -1,
    smallBlindIndex: null,
    bigBlindIndex: null,
    players,
    phase: 'preflop',
    currentPlayerIndex: null,
    currentBet: 0,
    minRaise: bigBlind,
    smallBlind: 0,
    bigBlind,
    ante,
    judgePlayerId: null,
    judgeWord: null,
    showdownMode: null,
    handComplete: false,
    tableComplete: false,
    showdown: null,
    argumentStatus: {
      opening: {},
      closing: {},
    },
    log: [],
  }

  return setUpNewHand(state, rng)
}

export function startNextHand(previousState, options = {}) {
  const state = deepClone(previousState)
  return setUpNewHand(state, options.rng)
}

export function applyPlayerAction(previousState, action, amount) {
  const state = deepClone(previousState)
  const actorIndex = state.currentPlayerIndex
  const player = ensureCanAct(state)

  if (state.phase === 'postflop' && !areArgumentsComplete(state, 'opening')) {
    throw new Error('All opening arguments must be marked before betting.')
  }

  if (action === 'fold') {
    applyFold(state, player)
  } else if (action === 'check') {
    applyCheck(state, player)
  } else if (action === 'call') {
    applyCall(state, player)
  } else if (action === 'bet') {
    applyBet(state, player, actorIndex, amount)
  } else if (action === 'raise') {
    applyRaise(state, player, actorIndex, amount)
  } else if (action === 'all-in') {
    applyAllIn(state, player, actorIndex)
  } else {
    throw new Error(`Unknown action: ${action}`)
  }

  return applyPostActionState(state, actorIndex)
}

export function markArgumentComplete(previousState, playerId, phaseKey = null) {
  const state = deepClone(previousState)
  const targetPhaseKey = phaseKey ?? getArgumentPhaseKey(state)

  markArgumentInPlace(state, playerId, targetPhaseKey)

  if (targetPhaseKey === 'opening') {
    return advanceIfOpeningArgumentsComplete(state)
  }

  if (targetPhaseKey === 'closing' && areArgumentsComplete(state, 'closing')) {
    return completeDebateStage(state)
  }

  return state
}

export function forceCompleteArguments(previousState, phaseKey = null) {
  const state = deepClone(previousState)
  const targetPhaseKey = phaseKey ?? getArgumentPhaseKey(state)

  forceCompleteArgumentsInPlace(state, targetPhaseKey)

  if (targetPhaseKey === 'opening') {
    return advanceIfOpeningArgumentsComplete(state)
  }

  if (targetPhaseKey === 'closing') {
    return completeDebateStage(state, { force: true })
  }

  return state
}

export function getArgumentProgress(state, phaseKey = null) {
  const targetPhaseKey = phaseKey ?? getArgumentPhaseKey(state)

  if (targetPhaseKey !== 'opening' && targetPhaseKey !== 'closing') {
    return {
      phaseKey: targetPhaseKey,
      speakers: [],
      requiredPlayerIds: [],
      arguedPlayerIds: [],
      waitingPlayerIds: [],
      complete: true,
    }
  }

  const status = ensureArgumentStatus(deepClone(state))[targetPhaseKey]
  const requiredPlayerIds = getRequiredArgumentPlayerIds(state, targetPhaseKey)
  const speakers = requiredPlayerIds.map((playerId) => ({
    playerId,
    playerName: getPlayerNameById(state, playerId),
    argued: Boolean(status[String(playerId)]),
  }))
  const arguedPlayerIds = speakers
    .filter((speaker) => speaker.argued)
    .map((speaker) => speaker.playerId)
  const waitingPlayerIds = speakers
    .filter((speaker) => !speaker.argued)
    .map((speaker) => speaker.playerId)

  return {
    phaseKey: targetPhaseKey,
    speakers,
    requiredPlayerIds,
    arguedPlayerIds,
    waitingPlayerIds,
    complete: waitingPlayerIds.length === 0,
  }
}

export function completeDebateStage(previousState, options = {}) {
  const state = deepClone(previousState)
  const { force = false } = options

  if (state.phase !== 'debate') {
    throw new Error('Closing arguments can only be completed during the closing arguments phase.')
  }

  if (!force && !areArgumentsComplete(state, 'closing')) {
    throw new Error('All closing arguments must be marked before advancing.')
  }

  if (state.showdownMode === 'similarityDuel') {
    return resolveSimilarityDuel(state)
  }

  return moveToShowdownVoting(state)
}

function resolveNeutralVoting(previousState, playerVotes) {
  const state = previousState

  if (state.showdownMode !== 'neutralVoting') {
    throw new Error('Neutral voting can only resolve a neutral judge showdown.')
  }

  if (!state.judgeWord) {
    throw new Error('Cannot resolve neutral voting without a neutral judge word.')
  }

  const resolution = buildNeutralVotingResolution(state, playerVotes)
  const winner = state.players.find((player) => player.id === resolution.winnerId)

  if (!winner) {
    throw new Error('Unable to find neutral showdown winner.')
  }

  const settlement = settlePotsByRanking(state, resolution.rankedPlayerIds)
  const winnerPayout = settlement.payoutByPlayerId.get(winner.id) ?? 0

  state.showdown = {
    type: 'neutralVoting',
    judgeWord: state.judgeWord,
    contenders: resolution.contenders.map((player) => {
      return {
        playerId: player.id,
        playerName: player.name,
        word: player.holeWord,
        playerVotesReceived: resolution.voteCountByPlayerId.get(player.id) ?? 0,
        similarity: resolution.similarityByPlayerId.get(player.id),
        categoryWins: resolution.categoryWinsByPlayerId.get(player.id),
      }
    }),
    categories: {
      playerVoteWinnerId: resolution.playerVoteWinner,
      similarityWinnerId: resolution.similarityWinner,
    },
    winner: {
      playerId: winner.id,
      playerName: winner.name,
      word: winner.holeWord,
      reason: resolution.winnerReason,
      categoryWins: resolution.categoryWinsByPlayerId.get(winner.id),
      payout: winnerPayout,
    },
    payouts: settlement.payouts,
    sidePots: settlement.sidePots,
    allSimilarityScores: buildAllSimilarityScores(state),
  }

  const playerVoteWinnerName =
    resolution.playerVoteWinner === null
      ? 'No clear majority'
      : state.players.find((player) => player.id === resolution.playerVoteWinner).name
  const similarityWinnerName = state.players.find(
    (player) => player.id === resolution.similarityWinner,
  ).name

  addLog(
    state,
    `Category winners -> Player Vote: ${playerVoteWinnerName}, Similarity: ${similarityWinnerName}.`,
  )
  addLog(state, `Winner logic -> ${buildNeutralVotingExplanation(resolution, winner)}`)
  logSidePotAwards(state, settlement)
  addLog(state, `${winner.name} wins the round for ${winnerPayout}.`)

  state.handComplete = true
  state.phase = 'handComplete'
  state.currentPlayerIndex = null
  markTableCompleteIfOnlyOnePlayerHasChips(state)

  return state
}

export function resolveShowdownVotes(previousState, payload) {
  const state = deepClone(previousState)

  if (state.phase !== 'showdownVoting') {
    throw new Error('Showdown votes can only be resolved during showdown voting phase.')
  }

  const { playerVotes = {}, judgeVote } = payload ?? {}

  const judge = getJudgePlayerFromState(state)

  if (!judge) {
    if (state.showdownMode === 'neutralVoting') {
      return resolveNeutralVoting(state, playerVotes)
    }

    throw new Error('Cannot resolve votes without an assigned judge.')
  }

  const resolution = buildVotingResolution(state, playerVotes, judgeVote)

  const winner = state.players.find((player) => player.id === resolution.winnerId)
  if (!winner) {
    throw new Error('Unable to find showdown winner.')
  }

  const judgeContribution = judge.totalCommitted
  const judgeAligned = resolution.judgeVoteWinner === winner.id
  const judgeWasFolded = judge.folded
  const judgeStakeRefund = judgeWasFolded ? 0 : judgeContribution
  const judgeTaxRate = judgeWasFolded ? FOLDED_JUDGE_TAX_RATE : ACTIVE_JUDGE_TAX_RATE
  const judgeCoveredPotTotal = getJudgeCoveredPotTotal(state, judge.id)
  const maxJudgeBonus = Math.max(0, judgeCoveredPotTotal - judgeStakeRefund)
  const judgeBonus = judgeAligned
    ? Math.min(Math.floor(judgeCoveredPotTotal * judgeTaxRate), maxJudgeBonus)
    : 0
  const judgePayout = judgeStakeRefund + judgeBonus
  const settlement = settlePotsByRanking(state, resolution.rankedPlayerIds, {
    judgePlayerId: judge.id,
    judgeStakeRefund,
    judgeBonus,
    judgePayout,
  })
  const winnerPayout = settlement.payoutByPlayerId.get(winner.id) ?? 0

  state.showdown = {
    type: 'voting',
    judge: {
      playerId: judge.id,
      playerName: judge.name,
      word: state.judgeWord,
      voteForPlayerId: resolution.judgeVoteWinner,
      alignedWithWinner: judgeAligned,
      contribution: judgeContribution,
      stakeRefund: judgeStakeRefund,
      bonus: judgeBonus,
      taxRate: judgeTaxRate,
      taxablePot: judgeCoveredPotTotal,
      payout: judgePayout,
      wasFolded: judgeWasFolded,
    },
    contenders: resolution.contenders.map((player) => {
      return {
        playerId: player.id,
        playerName: player.name,
        word: player.holeWord,
        playerVotesReceived: resolution.voteCountByPlayerId.get(player.id) ?? 0,
        similarity: resolution.similarityByPlayerId.get(player.id),
        categoryWins: resolution.categoryWinsByPlayerId.get(player.id),
      }
    }),
    categories: {
      playerVoteWinnerId: resolution.playerVoteWinner,
      judgeVoteWinnerId: resolution.judgeVoteWinner,
      similarityWinnerId: resolution.similarityWinner,
      playerVoteTieBrokenBySimilarity: resolution.playerVoteTieBrokenBySimilarity,
    },
    winner: {
      playerId: winner.id,
      playerName: winner.name,
      word: winner.holeWord,
      reason: resolution.winnerReason,
      categoryWins: resolution.categoryWinsByPlayerId.get(winner.id),
      payout: winnerPayout,
    },
    payouts: settlement.payouts,
    sidePots: settlement.sidePots,
    allSimilarityScores: buildAllSimilarityScores(state),
  }

  addLog(
    state,
    `Category winners -> Player Vote: ${state.players.find((player) => player.id === resolution.playerVoteWinner).name}, Judge Vote: ${state.players.find((player) => player.id === resolution.judgeVoteWinner).name}, Similarity: ${state.players.find((player) => player.id === resolution.similarityWinner).name}.`,
  )

  if (resolution.playerVoteTieBrokenBySimilarity) {
    addLog(
      state,
      `Player Vote was tied, so Similarity breaks the Player Vote category in favor of ${state.players.find((player) => player.id === resolution.playerVoteWinner).name}.`,
    )
  }

  addLog(state, `Winner logic -> ${buildWinnerExplanation(resolution, winner)}`)

  logSidePotAwards(state, settlement)
  addLog(state, `${winner.name} wins the round for ${winnerPayout}.`)

  if (judgeAligned) {
    if (judgeWasFolded) {
      if (judgeBonus > 0) {
        addLog(
          state,
          `${judge.name} selected the winner and receives folded Judge Tax ${judgeBonus} from Judge-covered pot layers (${Math.round(judgeTaxRate * 100)}% of ${judgeCoveredPotTotal}); folded stake is not refunded.`,
        )
      } else {
        addLog(
          state,
          `${judge.name} selected the winner, but no folded Judge Tax is available from covered pot layers; folded stake is not refunded.`,
        )
      }
    } else {
      addLog(
        state,
        `${judge.name} selected the winner and receives ${judgePayout} (stake refund ${judgeStakeRefund} + Judge Tax ${judgeBonus} from Judge-covered pot layers).`,
      )
    }
  } else if (!judgeWasFolded && judgeStakeRefund > 0) {
    addLog(
      state,
      `${judge.name} missed the winner but receives stake refund ${judgeStakeRefund}; no Judge Tax bonus.`,
    )
  } else {
    addLog(state, `${judge.name} missed the winner and receives no judge payout.`)
  }

  state.handComplete = true
  state.phase = 'handComplete'
  state.currentPlayerIndex = null
  markTableCompleteIfOnlyOnePlayerHasChips(state)

  return state
}

export function getLegalActions(state) {
  if (
    state.handComplete ||
    state.tableComplete ||
    state.currentPlayerIndex === null ||
    (state.phase !== 'preflop' && state.phase !== 'postflop')
  ) {
    return {
      fold: false,
      check: false,
      call: false,
      bet: false,
      raise: false,
      allIn: false,
      callAmount: 0,
      minBetTo: null,
      minRaiseTo: null,
      maxTo: null,
    }
  }

  const player = state.players[state.currentPlayerIndex]

  if (!isActionablePlayer(player)) {
    return {
      fold: false,
      check: false,
      call: false,
      bet: false,
      raise: false,
      allIn: false,
      callAmount: 0,
      minBetTo: null,
      minRaiseTo: null,
      maxTo: null,
    }
  }

  const toCall = getAmountToCall(state, player)
  const maxTo = player.betThisStreet + player.stack
  const minBetTo = player.betThisStreet + state.bigBlind
  const minRaiseTo = state.currentBet + state.minRaise

  return {
    fold: true,
    check: toCall === 0,
    call: toCall > 0,
    bet: toCall === 0 && player.stack > 0 && player.canRaise,
    raise: toCall > 0 && player.stack > toCall && player.canRaise,
    allIn: player.stack > 0,
    callAmount: Math.min(toCall, player.stack),
    minBetTo: minBetTo <= maxTo ? minBetTo : maxTo,
    minRaiseTo: minRaiseTo <= maxTo ? minRaiseTo : maxTo,
    maxTo,
  }
}

export function getCurrentActor(state) {
  if (state.currentPlayerIndex === null) {
    return null
  }

  return state.players[state.currentPlayerIndex]
}

export function getPhaseLabel(phase) {
  return PHASE_LABELS[phase] ?? phase
}

export function getJudgePlayer(state) {
  return getJudgePlayerFromState(state)
}

export function getContenders(state) {
  return getContenderList(state)
}

export function getPlayerVoteVoters(state) {
  return getPlayerVoteVoterList(state)
}

export function getPotSummary(state) {
  return {
    totalPot: getPotTotal(state),
    currentBet: state.currentBet,
    minRaise: state.minRaise,
    ante: getAnteAmount(state),
  }
}

export function getSimilarityForWords(playerWord, judgeWord) {
  return getSimilarityScore(playerWord, judgeWord)
}

export function getWordBankSize() {
  return WORDS.length
}
