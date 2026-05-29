export function summarizePlayerStatus(player, isActor) {
  if (!player.inHand) {
    return 'Out of chips'
  }

  if (player.folded) {
    return 'Folded'
  }

  if (player.isJudge) {
    return 'Judge (inactive)'
  }

  if (player.allIn) {
    return 'All-in'
  }

  if (isActor) {
    return 'Acting now'
  }

  return 'Waiting'
}

export function formatScore(value) {
  if (!Number.isFinite(value)) {
    return '--'
  }

  return value.toFixed(2)
}
