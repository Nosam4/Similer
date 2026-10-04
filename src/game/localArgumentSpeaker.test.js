import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  applyPlayerAction,
  createInitialGame,
  getArgumentProgress,
  getCurrentActor,
  markArgumentComplete,
} from '../wordgame/engine.js'
import { getLocalArgumentMarkPlayerId } from './localArgumentSpeaker.js'

describe('local argument speaker selection', () => {
  it('lets every opening and closing speaker finish without an override', () => {
    let game = createInitialGame()
    while (game.phase === 'preflop') {
      game = applyPlayerAction(game, 'check')
    }

    for (const phaseKey of ['opening', 'closing']) {
      const required = getArgumentProgress(game, phaseKey).requiredPlayerIds
      const marked = []
      for (let index = 0; index < required.length; index += 1) {
        const progress = getArgumentProgress(game, phaseKey)
        const actor = phaseKey === 'opening' ? getCurrentActor(game) : null
        const playerId = getLocalArgumentMarkPlayerId(progress, actor)
        assert.ok(progress.waitingPlayerIds.includes(playerId))
        assert.ok(!marked.includes(playerId), 'a finished speaker must not be selected again')
        marked.push(playerId)
        game = markArgumentComplete(game, playerId, phaseKey)
      }
      assert.deepEqual([...marked].sort(), [...required].sort())
      assert.equal(getArgumentProgress(game, phaseKey).complete, true)
      assert.equal(getLocalArgumentMarkPlayerId(getArgumentProgress(game, phaseKey)), null)

      if (phaseKey === 'opening') {
        while (game.phase === 'postflop') {
          game = applyPlayerAction(game, 'check')
        }
        assert.equal(game.phase, 'debate')
      }
    }
    assert.equal(game.phase, 'showdownVoting')
  })

  it('prefers an unfinished actor and skips that actor once marked', () => {
    assert.equal(getLocalArgumentMarkPlayerId({ waitingPlayerIds: [1, 3] }, { id: 3 }), 3)
    assert.equal(getLocalArgumentMarkPlayerId({ waitingPlayerIds: [1] }, { id: 3 }), 1)
    assert.equal(getLocalArgumentMarkPlayerId({ waitingPlayerIds: [] }, { id: 3 }), null)
  })
})
