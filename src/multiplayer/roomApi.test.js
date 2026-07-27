import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { shouldRetryGameCommand } from './commandRetry.js'

describe('game command retry policy', () => {
  it('retries transport and server failures while attempts remain', () => {
    assert.equal(
      shouldRetryGameCommand({
        command: 'playerAction',
        errorDetails: { message: 'Failed to send a request', name: 'FunctionsFetchError', status: 0 },
        attempt: 1,
      }),
      true,
    )
    assert.equal(
      shouldRetryGameCommand({
        command: 'playerAction',
        errorDetails: { message: 'Service unavailable', name: '', status: 503 },
        attempt: 2,
      }),
      true,
    )
  })

  it('retries version conflicts only for safe argument completion commands', () => {
    const conflict = {
      message: 'Room state changed on another device. Please try again.',
      name: 'FunctionsHttpError',
      status: 400,
    }

    assert.equal(
      shouldRetryGameCommand({ command: 'markArgumentComplete', errorDetails: conflict, attempt: 1 }),
      true,
    )
    assert.equal(
      shouldRetryGameCommand({ command: 'playerAction', errorDetails: conflict, attempt: 1 }),
      false,
    )
  })

  it('stops retrying after the final attempt and does not retry validation errors', () => {
    assert.equal(
      shouldRetryGameCommand({
        command: 'markArgumentComplete',
        errorDetails: { message: 'Room state changed on another device', name: '', status: 400 },
        attempt: 3,
      }),
      false,
    )
    assert.equal(
      shouldRetryGameCommand({
        command: 'playerAction',
        errorDetails: { message: 'It is not your turn yet.', name: 'FunctionsHttpError', status: 400 },
        attempt: 1,
      }),
      false,
    )
  })
})
