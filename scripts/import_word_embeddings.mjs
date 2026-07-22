#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import process from 'node:process'
import { createClient } from '@supabase/supabase-js'

const DEFAULT_INPUT_PATH = 'supabase/.private/word-embeddings.json'
const EXPECTED_DIMENSIONS = 300
const DEFAULT_BATCH_SIZE = 20

function requireEnvironment(name) {
  const value = process.env[name]

  if (!value) {
    throw new Error(`${name} is required.`)
  }

  return value
}

function validatePayload(payload) {
  if (!payload || !Array.isArray(payload.words) || payload.words.length === 0) {
    throw new Error('Embedding file must contain a non-empty words array.')
  }

  if (payload.dimensions !== EXPECTED_DIMENSIONS) {
    throw new Error(`Expected ${EXPECTED_DIMENSIONS} dimensions, received ${payload.dimensions}.`)
  }

  if (payload.normalized !== true) {
    throw new Error('Embedding file must contain normalized vectors.')
  }

  if (!payload.embeddingModel) {
    throw new Error('Embedding file must identify its embeddingModel.')
  }

  const seenWords = new Set()

  for (const record of payload.words) {
    if (!record?.word || record.word !== record.word.trim().toLowerCase()) {
      throw new Error(`Word is not normalized: ${String(record?.word)}`)
    }
    if (seenWords.has(record.word)) {
      throw new Error(`Duplicate word: ${record.word}`)
    }
    if (!Array.isArray(record.embedding) || record.embedding.length !== EXPECTED_DIMENSIONS) {
      throw new Error(`Word ${record.word} does not have ${EXPECTED_DIMENSIONS} dimensions.`)
    }
    if (!record.embedding.every(Number.isFinite)) {
      throw new Error(`Word ${record.word} contains a non-finite embedding value.`)
    }

    seenWords.add(record.word)
  }
}

async function main() {
  const inputPath = process.argv[2] ?? DEFAULT_INPUT_PATH
  const batchSize = Number(process.env.WORD_EMBEDDING_BATCH_SIZE ?? DEFAULT_BATCH_SIZE)
  const payload = JSON.parse(await readFile(inputPath, 'utf8'))
  validatePayload(payload)

  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100) {
    throw new Error('WORD_EMBEDDING_BATCH_SIZE must be an integer between 1 and 100.')
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

  let importedCount = 0

  for (let offset = 0; offset < payload.words.length; offset += batchSize) {
    const batch = payload.words.slice(offset, offset + batchSize)
    const response = await client.rpc('upsert_word_embeddings', {
      p_embedding_model: payload.embeddingModel,
      p_words: batch,
    })

    if (response.error) {
      throw new Error(`Embedding import failed at offset ${offset}: ${response.error.message}`)
    }

    importedCount += Number(response.data ?? 0)
    process.stdout.write(`Imported ${Math.min(offset + batch.length, payload.words.length)}/${payload.words.length}\r`)
  }

  process.stdout.write('\n')

  const statusResponse = await client.rpc('get_word_catalog_status')
  if (statusResponse.error) {
    throw new Error(`Unable to verify word catalog: ${statusResponse.error.message}`)
  }

  console.log(`Upserted ${importedCount} word embeddings.`)
  console.log('Catalog status:', statusResponse.data)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
