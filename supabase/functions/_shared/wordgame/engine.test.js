import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  applyPlayerAction,
  createInitialGame,
  drawNeutralJudgeWord,
  resolveShowdownVotes,
} from './engine.js'
import { attachServerSimilarityScores } from './serverSimilarityScores.js'
import { attachServerCatalogDeal } from './serverWordDeal.js'

function makeShowdownState() {
  const state = createInitialGame({
    playerNames: ['North', 'East', 'South', 'West'],
  })
  const words = ['apple', 'river', 'planet', 'zombie']
  state.players = state.players.map((player) => ({
    ...player,
    holeWord: words[player.id],
  }))

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

  it('fails closed when no complete database score map is attached', () => {
    const state = makeShowdownState()
    assert.throws(
      () => resolveShowdownVotes(state, {
        playerVotes: {
          0: '1',
          1: '0',
          2: '0',
        },
        judgeVote: '1',
      }),
      /Database similarity score is unavailable/,
    )
  })
})

describe('backend engine reserved neutral Judge word', () => {
  it('uses the database reservation', () => {
    const initialState = createInitialGame({ playerNames: ['North', 'East', 'South'] })

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

    assert.equal(drawNeutralJudgeWord(state), 'zombie')
  })

  it('fails closed without a database reservation', () => {
    const state = createInitialGame({ playerNames: ['North', 'East', 'South'] })
    assert.throws(() => drawNeutralJudgeWord(state), /Database reserved neutral Judge word/)
  })
})

describe('backend engine database dealing boundary', () => {
  it('leaves active player words empty for the transactional catalog dealer', () => {
    const state = createInitialGame({ playerNames: ['North', 'East', 'South'] })
    assert.ok(state.players.every((player) => player.holeWord === null))
  })

  it('settles an uncontested hand without requesting irrelevant similarity scores', () => {
    let state = createInitialGame({ playerNames: ['North', 'East', 'South'] })
    state = applyPlayerAction(state, 'fold')
    state = applyPlayerAction(state, 'fold')

    assert.equal(state.phase, 'handComplete')
    assert.equal(state.showdown.type, 'uncontested')
    assert.deepEqual(state.showdown.allSimilarityScores, [])
    assert.ok(state.showdown.sidePots.every((pot) => pot.winningSimilarity === null))
  })
})
