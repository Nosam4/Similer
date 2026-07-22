import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createInitialGame, drawNeutralJudgeWord, getSimilarityForWords, resolveShowdownVotes } from './engine.js'
import { attachServerSimilarityScores } from './serverSimilarityScores.js'
import { attachServerCatalogDeal } from './serverWordDeal.js'

function makeShowdownState() {
  const state = createInitialGame({
    playerNames: ['North', 'East', 'South', 'West'],
    rng: () => 0.25,
  })

  state.phase = 'showdownVoting'
  state.currentPlayerIndex = null
  state.judgePlayerId = 3
  state.judgeWord = state.players[3].holeWord
  state.players[3].isJudge = true

  return state
}

describe('backend engine database similarity injection', () => {
  it('uses injected server scores for categories, ranking, and the completed-hand report', () => {
    const state = attachServerSimilarityScores(makeShowdownState(), {
      0: 10,
      1: 99,
      2: 20,
      3: 100,
    })

    const resolved = resolveShowdownVotes(state, {
      playerVotes: {
        0: '1',
        1: '0',
        2: '0',
      },
      judgeVote: '1',
    })

    assert.equal(resolved.showdown.categories.playerVoteWinnerId, 0)
    assert.equal(resolved.showdown.categories.judgeVoteWinnerId, 1)
    assert.equal(resolved.showdown.categories.similarityWinnerId, 1)
    assert.equal(resolved.showdown.winner.playerId, 1)

    const scoresByPlayerId = Object.fromEntries(
      resolved.showdown.allSimilarityScores.map((row) => [row.playerId, row.similarity]),
    )
    assert.deepEqual(scoresByPlayerId, {
      0: 10,
      1: 99,
      2: 20,
      3: 100,
    })
  })

  it('retains the matrix lookup when no complete server score map is attached', () => {
    const state = makeShowdownState()
    const resolved = resolveShowdownVotes(state, {
      playerVotes: {
        0: '1',
        1: '0',
        2: '0',
      },
      judgeVote: '1',
    })

    for (const row of resolved.showdown.allSimilarityScores) {
      assert.equal(row.similarity, getSimilarityForWords(row.word, state.judgeWord))
    }
  })
})

describe('backend engine reserved neutral Judge word', () => {
  it('uses the database reservation instead of drawing from the fallback matrix', () => {
    const initialState = createInitialGame({ playerNames: ['North', 'East', 'South'], rng: () => 0 })
    initialState.players = initialState.players.map((player) => ({ ...player, holeWord: null }))

    const state = attachServerCatalogDeal(
      initialState,
      {
        dealVersion: 4,
        wordsByPlayerId: {
          0: 'apple',
          1: 'river',
          2: 'planet',
        },
        neutralWord: 'zombie',
      },
    )

    assert.equal(drawNeutralJudgeWord(state, () => 0), 'zombie')
  })
})
