export function getLocalArgumentMarkPlayerId(progress, actor = null) {
  const waitingPlayerIds = progress?.waitingPlayerIds ?? []

  if (actor && waitingPlayerIds.includes(actor.id)) {
    return actor.id
  }

  return waitingPlayerIds[0] ?? null
}
