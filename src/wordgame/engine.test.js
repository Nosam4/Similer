import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import * as localEngine from './engine.js'
import * as serverEngine from '../../supabase/functions/_shared/wordgame/engine.js'
import { attachServerCatalogDeal } from '../../supabase/functions/_shared/wordgame/serverWordDeal.js'

for (const [label, engine] of [['local', localEngine], ['server', serverEngine]]) {
  describe(`${label} all-in legality`, () => {
    function makeShortRaiseState() {
      let state = engine.createInitialGame()
      state = attachServerCatalogDeal(state, {
        dealVersion: 1,
        wordsByPlayerId: Object.fromEntries(state.players.map((player) => [
          player.id, player.holeWord ?? ['apple', 'river', 'planet', 'zombie'][player.id],
        ])),
        neutralWord: 'bridge',
      })
      state.players[2].stack = 35
      state = engine.applyPlayerAction(state, 'bet', 30)
      state = engine.applyPlayerAction(state, 'all-in')
      state = engine.applyPlayerAction(state, 'call')
      return engine.applyPlayerAction(state, 'call')
    }

    it('disables an all-in raise when a short raise has not reopened betting', () => {
      const state = makeShortRaiseState()
      assert.equal(engine.getCurrentActor(state).canRaise, false)
      assert.equal(engine.getLegalActions(state).allIn, false)
      assert.throws(() => engine.applyPlayerAction(state, 'all-in'), /not reopened/)
    })

    for (const stack of [3, 5]) {
      it(`still permits an all-in call of ${stack} when raising is closed`, () => {
        const state = makeShortRaiseState()
        engine.getCurrentActor(state).stack = stack
        const committedBefore = engine.getCurrentActor(state).totalCommitted
        assert.equal(engine.getCurrentActor(state).canRaise, false)
        assert.equal(engine.getLegalActions(state).allIn, true)
        const next = engine.applyPlayerAction(state, 'all-in')
        assert.equal(next.players[1].stack, 0)
        assert.equal(next.players[1].totalCommitted, committedBefore + stack)
      })
    }

    it('permits an all-in raise before raising rights are closed', () => {
      const state = engine.createInitialGame()
      const availableStack = engine.getCurrentActor(state).stack
      assert.equal(engine.getLegalActions(state).allIn, true)
      const next = engine.applyPlayerAction(state, 'all-in')
      assert.equal(next.players[1].stack, 0)
      assert.equal(next.currentBet, availableStack)
    })
  })
}
