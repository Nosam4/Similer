import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ROOM_FALLBACK_POLL_INTERVAL_MS, shouldPollRoom } from './roomPolling.js'

describe('room polling cadence', () => {
  it('keeps a periodic safety check but reduces healthy polling twelvefold', () => {
    function countPolls(connectionMode) {
      let lastPolledAt = 0
      let count = 0
      for (let now = ROOM_FALLBACK_POLL_INTERVAL_MS; now <= 60_000; now += ROOM_FALLBACK_POLL_INTERVAL_MS) {
        if (shouldPollRoom({ connectionMode, lastPolledAt, now })) {
          count += 1
          lastPolledAt = now
        }
      }
      return count
    }
    assert.equal(countPolls('live'), 2)
    assert.equal(countPolls('polling'), 24)
    assert.equal(countPolls('reconnecting'), 24)
  })

  it('resumes fast polling when connection health degrades', () => {
    const times = { lastPolledAt: 30_000, now: 32_500 }
    assert.equal(shouldPollRoom({ ...times, connectionMode: 'live' }), false)
    assert.equal(shouldPollRoom({ ...times, connectionMode: 'reconnecting' }), true)
    assert.equal(shouldPollRoom({ ...times, connectionMode: 'polling' }), true)
    assert.equal(shouldPollRoom({ ...times, now: 32_499, connectionMode: 'polling' }), false)
  })
})
