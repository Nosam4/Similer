import { createInitialGame } from './engine.js'

export function createRoomGame(roomPlayers, options = {}) {
  const seatedPlayers = [...roomPlayers].sort((left, right) => left.seat_index - right.seat_index)

  if (seatedPlayers.length < 3 || seatedPlayers.length > 8) {
    throw new Error('Need between 3 and 8 players to start this game mode.')
  }

  return createInitialGame({
    ...options,
    playerNames: seatedPlayers.map((player) => player.display_name),
    // IDs are persistent room seats; currentPlayerIndex remains an array index.
    playerIds: seatedPlayers.map((player) => Number(player.seat_index)),
  })
}
