import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  getReconnectRoomCode,
  getRoomExitButtonLabel,
  getRoomExitMode,
} from './roomExit.js'

describe('online room exit behavior', () => {
  it('disconnects without releasing the seat while a room is playing', () => {
    const room = { code: 'ABC123', status: 'playing' }

    assert.equal(getRoomExitMode(room), 'disconnect')
    assert.equal(getRoomExitButtonLabel(room), 'Disconnect')
    assert.equal(getReconnectRoomCode(room), 'ABC123')
  })

  it('leaves waiting and finished rooms normally', () => {
    for (const status of ['waiting', 'finished']) {
      const room = { code: 'ABC123', status }

      assert.equal(getRoomExitMode(room), 'leave')
      assert.equal(getRoomExitButtonLabel(room), 'Leave')
      assert.equal(getReconnectRoomCode(room), '')
    }
  })

  it('handles a missing room', () => {
    assert.equal(getRoomExitMode(null), 'none')
    assert.equal(getRoomExitButtonLabel(null), 'Leave')
    assert.equal(getReconnectRoomCode(null), '')
  })
})
