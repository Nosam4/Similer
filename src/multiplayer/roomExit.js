export function getRoomExitMode(room) {
  if (!room) {
    return 'none'
  }

  return room.status === 'playing' ? 'disconnect' : 'leave'
}

export function getRoomExitButtonLabel(room) {
  return getRoomExitMode(room) === 'disconnect' ? 'Disconnect' : 'Leave'
}

export function getReconnectRoomCode(room) {
  return getRoomExitMode(room) === 'disconnect' ? String(room.code ?? '') : ''
}
