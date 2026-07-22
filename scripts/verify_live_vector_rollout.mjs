#!/usr/bin/env node

import process from 'node:process'
import { createClient } from '@supabase/supabase-js'

function requireEnvironment(name) {
  const value = process.env[name]

  if (!value) {
    throw new Error(`${name} is required.`)
  }

  return value
}

async function main() {
  const expectedCatalogSize = Number(process.env.EXPECTED_WORD_CATALOG_SIZE ?? 100)

  if (!Number.isInteger(expectedCatalogSize) || expectedCatalogSize < 1) {
    throw new Error('EXPECTED_WORD_CATALOG_SIZE must be a positive integer.')
  }

  const client = createClient(
    requireEnvironment('SUPABASE_URL'),
    requireEnvironment('SUPABASE_SERVICE_ROLE_KEY'),
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  )

  const statusResponse = await client.rpc('get_word_catalog_status')
  if (statusResponse.error) {
    throw new Error(`Catalog status RPC failed: ${statusResponse.error.message}`)
  }

  const catalog = statusResponse.data?.find(
    (row) => row.embedding_model === 'word2vec-google-news-300',
  )

  if (
    !catalog ||
    Number(catalog.word_count) !== expectedCatalogSize ||
    Number(catalog.active_word_count) !== expectedCatalogSize
  ) {
    throw new Error(
      `Catalog does not contain exactly ${expectedCatalogSize} active word2vec-google-news-300 rows.`,
    )
  }

  console.log(`Catalog check: ${expectedCatalogSize}/${expectedCatalogSize} active embeddings`)

  const sampleResponse = await client
    .from('hand_words')
    .select('room_id, hand_number, player_id, word')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (sampleResponse.error) {
    throw new Error(`Unable to inspect a hand sample: ${sampleResponse.error.message}`)
  }

  if (!sampleResponse.data) {
    console.log('Pair-scoring check: skipped because no hand words exist yet')
    return
  }

  const handResponse = await client
    .from('hand_words')
    .select('player_id')
    .eq('room_id', sampleResponse.data.room_id)
    .eq('hand_number', sampleResponse.data.hand_number)

  if (handResponse.error) {
    throw new Error(`Unable to inspect the sampled hand: ${handResponse.error.message}`)
  }

  const scoreResponse = await client.rpc('score_hand_word_similarities', {
    p_room_id: sampleResponse.data.room_id,
    p_hand_number: sampleResponse.data.hand_number,
    p_judge_word: sampleResponse.data.word,
  })

  if (scoreResponse.error) {
    throw new Error(`Pair-scoring RPC failed: ${scoreResponse.error.message}`)
  }

  if (scoreResponse.data.length !== handResponse.data.length) {
    throw new Error('Pair-scoring RPC returned an incomplete hand.')
  }

  const selfScore = scoreResponse.data.find(
    (row) => Number(row.player_id) === Number(sampleResponse.data.player_id),
  )

  if (!selfScore || Math.abs(Number(selfScore.score) - 100) > 0.01) {
    throw new Error('Pair-scoring RPC did not return a 100 self-similarity score.')
  }

  console.log(`Pair-scoring check: ${scoreResponse.data.length} complete finite scores`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
