import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  attachServerSimilarityScores,
  buildServerSimilarityScores,
  getServerSimilarityScore,
  removeServerSimilarityScores,
  SERVER_SIMILARITY_SCORES_FIELD,
} from './serverSimilarityScores.js'

describe('server similarity score helpers', () => {
  it('builds a complete player score map from database rows', () => {
    assert.deepEqual(
      buildServerSimilarityScores(
        [
          { player_id: 0, score: 12.34 },
          { player_id: 1, score: '56.78' },
        ],
        [0, 1],
      ),
      {
        0: 12.34,
        1: 56.78,
      },
    )
  })

  it('rejects partial, duplicate, and non-finite database results', () => {
    assert.equal(buildServerSimilarityScores([{ player_id: 0, score: 1 }], [0, 1]), null)
    assert.equal(
      buildServerSimilarityScores(
        [
          { player_id: 0, score: 1 },
          { player_id: 1, score: 2 },
        ],
        [0],
      ),
      null,
    )
    assert.equal(
      buildServerSimilarityScores(
        [
          { player_id: 0, score: 1 },
          { player_id: 0, score: 2 },
        ],
        [0],
      ),
      null,
    )
    assert.equal(buildServerSimilarityScores([{ player_id: 0, score: 'not-a-score' }], [0]), null)
    assert.equal(buildServerSimilarityScores([{ player_id: null, score: 0 }], [0]), null)
    assert.equal(buildServerSimilarityScores([{ player_id: 0, score: null }], [0]), null)
  })

  it('keeps scores transient and reports a missing attached player as unavailable', () => {
    const original = { handNumber: 3 }
    const hydrated = attachServerSimilarityScores(original, { 2: 91.25 })

    assert.equal(getServerSimilarityScore(hydrated, 2), 91.25)
    assert.equal(getServerSimilarityScore(hydrated, 3), null)
    assert.equal(getServerSimilarityScore(original, 2), null)
    assert.equal(removeServerSimilarityScores(hydrated)[SERVER_SIMILARITY_SCORES_FIELD], undefined)
    assert.deepEqual(original, { handNumber: 3 })
  })
})
