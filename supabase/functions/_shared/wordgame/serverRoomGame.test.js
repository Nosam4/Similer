import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createRoomGame } from './serverRoomGame.js'
import { applyPlayerAction, getCurrentActor, resolveShowdownVotes, startNextHand } from './engine.js'
import { attachServerCatalogDeal, buildServerCatalogDeal } from './serverWordDeal.js'
import { attachServerSimilarityScores } from './serverSimilarityScores.js'

describe('room games with vacant seats', () => {
  for (const seats of [[0, 2, 3], [1, 3, 7]]) {
    it(`preserves seats ${seats} through dealing, turns, and subsequent hands`, () => {
      const roomPlayers = seats.map((seat, index) => ({
        seat_index: seat, display_name: ['North', 'East', 'South'][index],
      }))
      let state = createRoomGame([...roomPlayers].reverse())
      assert.deepEqual(state.players.map((player) => player.id), seats)
      assert.deepEqual(state.players.map((player) => player.name), ['North', 'East', 'South'])

      const words = ['apple', 'river', 'planet']
      const deal = buildServerCatalogDeal(seats.map((seat, index) => ({
        player_id: seat, word: words[index], catalog_word_id: index + 1, deal_version: 2,
      })), [{ word: 'bridge', catalog_word_id: 4, deal_version: 2 }], seats)
      assert.ok(deal)
      state = attachServerCatalogDeal(state, deal)
      assert.equal(getCurrentActor(state).id, seats[1])
      assert.equal(getCurrentActor(state).holeWord, 'river')
      state = applyPlayerAction(state, 'fold')
      assert.equal(getCurrentActor(state).id, seats[2])
      state = applyPlayerAction(state, 'fold')
      assert.equal(state.handComplete, true)
      assert.equal(state.showdown.winnerId, seats[0])

      state = startNextHand(state)
      assert.deepEqual(state.players.map((player) => player.id), seats)
      assert.equal(getCurrentActor(state).id, seats[2])
      assert.deepEqual(createRoomGame(roomPlayers).players.map((player) => player.id), seats)
    })
  }

  it('resolves voting and payouts using seat IDs instead of array indexes', () => {
    let state = createRoomGame([1, 3, 5, 7].map((seat_index) => ({
      seat_index, display_name: 'Player',
    })))
    state = attachServerCatalogDeal(state, {
      dealVersion: 2,
      wordsByPlayerId: { 1: 'apple', 3: 'river', 5: 'planet', 7: 'zombie' },
      neutralWord: 'bridge',
    })
    state.phase = 'showdownVoting'
    state.currentPlayerIndex = null
    state.judgePlayerId = 7
    state.judgeWord = 'zombie'
    state.players[3].isJudge = true
    state = attachServerSimilarityScores(state, { 1: 10, 3: 99, 5: 20, 7: 100 })
    const next = resolveShowdownVotes(state, {
      playerVotes: { 1: '3', 3: '1', 5: '1' }, judgeVote: '3',
    })
    assert.equal(next.showdown.winner.playerId, 3)
    assert.equal(next.players.reduce((total, player) => total + player.stack, 0), 1600)
  })

  it('rejects duplicate seats', () => {
    assert.throws(() => createRoomGame([0, 2, 2].map((seat_index) => ({
      seat_index, display_name: 'Player',
    }))), /unique room seats/)
  })
})
