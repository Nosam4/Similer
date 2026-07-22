import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  attachServerCatalogDeal,
  buildServerCatalogDeal,
  getServerNeutralJudgeWord,
  hasServerCatalogDeal,
  removeServerCatalogDeal,
} from './serverWordDeal.js'

const WORD_ROWS = [
  { player_id: 0, word: 'apple', catalog_word_id: 11, deal_version: 4 },
  { player_id: 2, word: 'river', catalog_word_id: 12, deal_version: 4 },
]
const RESERVATION_ROWS = [
  { word: 'planet', catalog_word_id: 13, deal_version: 4, cycle_number: 1 },
]

describe('server catalog deal helpers', () => {
  it('builds and attaches a complete private deal with its reserved neutral word', () => {
    const deal = buildServerCatalogDeal(WORD_ROWS, RESERVATION_ROWS, [0, 2])
    assert.deepEqual(deal, {
      dealVersion: 4,
      wordsByPlayerId: { 0: 'apple', 2: 'river' },
      neutralWord: 'planet',
    })

    const game = {
      judgePlayerId: null,
      players: [
        { id: 0, holeWord: null },
        { id: 1, holeWord: null },
        { id: 2, holeWord: null },
      ],
    }
    const hydrated = attachServerCatalogDeal(game, deal)

    assert.equal(hydrated.players[0].holeWord, 'apple')
    assert.equal(hydrated.players[1].holeWord, null)
    assert.equal(hydrated.players[2].holeWord, 'river')
    assert.equal(getServerNeutralJudgeWord(hydrated), 'planet')
    assert.equal(hasServerCatalogDeal(hydrated), true)
    const sanitized = removeServerCatalogDeal(hydrated)
    assert.equal(getServerNeutralJudgeWord(sanitized), null)
    assert.equal(hasServerCatalogDeal(sanitized), false)
    assert.equal(game.players[0].holeWord, null)
  })

  it('rejects partial, mixed-version, duplicate, and colliding catalog deals', () => {
    assert.equal(buildServerCatalogDeal(WORD_ROWS.slice(0, 1), RESERVATION_ROWS, [0, 2]), null)
    assert.equal(
      buildServerCatalogDeal(
        [WORD_ROWS[0], { ...WORD_ROWS[1], deal_version: 5 }],
        RESERVATION_ROWS,
        [0, 2],
      ),
      null,
    )
    assert.equal(
      buildServerCatalogDeal(
        [WORD_ROWS[0], { ...WORD_ROWS[1], catalog_word_id: 11 }],
        RESERVATION_ROWS,
        [0, 2],
      ),
      null,
    )
    assert.equal(
      buildServerCatalogDeal(
        WORD_ROWS,
        [{ ...RESERVATION_ROWS[0], word: 'apple' }],
        [0, 2],
      ),
      null,
    )
  })

  it('recognizes legacy hand rows without catalog markers', () => {
    assert.equal(
      buildServerCatalogDeal(
        [
          { player_id: 0, word: 'apple', catalog_word_id: null, deal_version: null },
          { player_id: 2, word: 'river', catalog_word_id: null, deal_version: null },
        ],
        [],
        [0, 2],
      ),
      null,
    )
  })
})
