import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.106.2'
import {
  applyPlayerAction,
  completeDebateStage,
  createInitialGame,
  forceCompleteArguments,
  markArgumentComplete,
  resolveShowdownVotes,
  startNextHand,
} from '../_shared/wordgame/engine.js'
import {
  attachServerSimilarityScores,
  buildServerSimilarityScores,
  removeServerSimilarityScores,
} from '../_shared/wordgame/serverSimilarityScores.js'
import {
  attachServerCatalogDeal,
  buildServerCatalogDeal,
  removeServerCatalogDeal,
} from '../_shared/wordgame/serverWordDeal.js'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const STARTING_STACK = 400
const ANTE = 10
const MIN_BET = 10
const PUBLIC_WORD_PHASES = new Set(['debate', 'showdownVoting', 'handComplete'])
const FALLBACK_PLAYER_NAMES = ['North', 'East', 'South', 'West', 'Alpha', 'Bravo', 'Charlie', 'Delta']
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json',
    },
  })
}

async function measureStage<T>(timings: Record<string, number>, stage: string, operation: () => Promise<T>) {
  const startedAt = performance.now()

  try {
    return await operation()
  } finally {
    timings[stage] = Math.round((performance.now() - startedAt) * 10) / 10
  }
}

function measureSyncStage<T>(timings: Record<string, number>, stage: string, operation: () => T) {
  const startedAt = performance.now()

  try {
    return operation()
  } finally {
    timings[stage] = Math.round((performance.now() - startedAt) * 10) / 10
  }
}

function normalizeCommandId(value: unknown) {
  if (value === null || value === undefined || String(value).trim() === '') {
    return crypto.randomUUID()
  }

  const commandId = String(value).trim()
  if (!UUID_PATTERN.test(commandId)) {
    throw new Error('Command id must be a valid UUID.')
  }

  return commandId
}

function classifyCommandError(error: unknown) {
  const message = error instanceof Error ? error.message : ''

  if (/Authentication required/i.test(message)) return 'authentication_required'
  if (/Room membership required/i.test(message)) return 'membership_required'
  if (/Room not found/i.test(message)) return 'room_not_found'
  if (/Room state not found|No active game state/i.test(message)) return 'state_not_found'
  if (/not your turn/i.test(message)) return 'wrong_turn'
  if (/Only the room host/i.test(message)) return 'host_required'
  if (/Room state changed on another device/i.test(message)) return 'version_conflict'
  if (/Database|catalog|similarity|reserved neutral Judge word/i.test(message)) return 'database_operation_failed'
  if (/Unknown game command/i.test(message)) return 'unknown_command'
  if (/Command id/i.test(message)) return 'invalid_command_id'
  return 'game_command_rejected'
}

function logCommandResult({
  command,
  errorCode = null,
  replayed = false,
  startedAt,
  status,
  timings,
}: {
  command: string
  errorCode?: string | null
  replayed?: boolean
  startedAt: number
  status: 'accepted' | 'rejected'
  timings: Record<string, number>
}) {
  const entry = {
    event: 'game_action',
    command: command || 'unknown',
    status,
    replayed,
    errorCode,
    durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
    timings,
  }

  if (status === 'accepted') {
    console.log(JSON.stringify(entry))
  } else {
    console.error(JSON.stringify(entry))
  }
}

function cloneGame(game: any) {
  return structuredClone(game)
}

function shouldPublishWord(game: any, player: any) {
  if (!player?.holeWord) {
    return false
  }

  if (player.isJudge) {
    return true
  }

  return Boolean(player.inHand && (PUBLIC_WORD_PHASES.has(game.phase) || game.handComplete))
}

function sanitizeGameForRoomState(game: any) {
  const sanitized = removeServerCatalogDeal(removeServerSimilarityScores(cloneGame(game)))
  delete sanitized.onlineVotes

  sanitized.players = sanitized.players.map((player: any) => {
    if (shouldPublishWord(sanitized, player)) {
      return player
    }

    return {
      ...player,
      holeWord: null,
    }
  })

  return sanitized
}

function getPublicRevealPlayerIds(game: any) {
  if (!game) {
    return []
  }

  return game.players
    .filter((player: any) => shouldPublishWord(game, player))
    .map((player: any) => player.id)
}

function hydrateGameWithWords(game: any, wordRows: Array<{ player_id: number; word: string }>) {
  const hydrated = cloneGame(game)
  const wordByPlayerId = new Map(wordRows.map((row) => [Number(row.player_id), row.word]))

  hydrated.players = hydrated.players.map((player: any) => {
    const privateWord = wordByPlayerId.get(Number(player.id))

    if (!privateWord) {
      return player
    }

    return {
      ...player,
      holeWord: privateWord,
    }
  })

  const judge = hydrated.players.find((player: any) => player.id === hydrated.judgePlayerId)
  if (judge?.holeWord) {
    hydrated.judgeWord = judge.holeWord
  }

  return hydrated
}

function buildVotesPayload(voteRows: Array<{ vote_type: string; voter_player_id: number; target_player_id: number }>) {
  const playerVotes: Record<number, string> = {}
  let judgeVote: string | null = null

  for (const row of voteRows) {
    if (row.vote_type === 'player') {
      playerVotes[Number(row.voter_player_id)] = String(row.target_player_id)
    } else if (row.vote_type === 'judge') {
      judgeVote = String(row.target_player_id)
    }
  }

  return {
    playerVotes,
    judgeVote,
  }
}

function getPlayerVoteVoterIds(game: any) {
  return game.players
    .filter((player: any) => !player.isJudge)
    .map((player: any) => Number(player.id))
}

function normalizeDisplayName(input: unknown, index = 0) {
  const cleanName = String(input ?? '')
    .replace(/[^a-z]/gi, '')
    .slice(0, 8)

  return cleanName || FALLBACK_PLAYER_NAMES[index] || 'Player'
}

function getRoomPlayerNames(roomPlayers: any[]) {
  return [...roomPlayers]
    .sort((left, right) => left.seat_index - right.seat_index)
    .map((player, index) => normalizeDisplayName(player.display_name, index))
}

async function requireSupabaseUser(req: Request, supabaseUrl: string, anonKey: string) {
  const authHeader = req.headers.get('Authorization') ?? ''

  if (!authHeader) {
    throw new Error('Authentication required.')
  }

  const authClient = createClient(supabaseUrl, anonKey, {
    global: {
      headers: {
        Authorization: authHeader,
      },
    },
    auth: {
      persistSession: false,
    },
  })

  const { data, error } = await authClient.auth.getUser()
  if (error || !data.user) {
    throw new Error('Authentication required.')
  }

  return data.user
}

async function fetchGameActionContext(
  serviceClient: any,
  roomId: string,
  actorUserId: string,
  commandId: string,
) {
  const { data, error } = await serviceClient.rpc('get_game_action_context', {
    p_room_id: roomId,
    p_actor_user_id: actorUserId,
    p_command_id: commandId,
  })

  if (error) {
    throw new Error(`Unable to load game action context: ${error.message}`)
  }

  if (!data?.room) throw new Error('Room not found.')
  if (!data?.roomState) throw new Error('Room state not found.')

  return {
    room: data.room,
    roomPlayers: Array.isArray(data.roomPlayers) ? data.roomPlayers : [],
    roomState: data.roomState,
    wordRows: Array.isArray(data.handWords) ? data.handWords : [],
    reservationRows: data.reservation ? [data.reservation] : [],
    receipt: data.receipt ?? null,
  }
}

async function hydrateGameWithPrivateHand(
  game: any,
  wordRows: Array<{
    player_id: number
    word: string
    catalog_word_id: number | null
    deal_version: number | null
  }>,
  reservationRows: Array<{
    deal_version: number
    cycle_number: number
    catalog_word_id: number
    word: string
  }>,
) {
  const catalogRow = wordRows.find(
    (row) =>
      (row.catalog_word_id !== null && row.catalog_word_id !== undefined) ||
      (row.deal_version !== null && row.deal_version !== undefined),
  )

  if (!catalogRow) {
    return hydrateGameWithWords(game, wordRows)
  }

  if (!Number.isInteger(Number(catalogRow.deal_version)) || Number(catalogRow.deal_version) < 1) {
    throw new Error('Catalog hand contains an invalid deal version.')
  }

  const expectedPlayerIds = game.players
    .filter((player: any) => player.inHand)
    .map((player: any) => Number(player.id))
  const deal = buildServerCatalogDeal(wordRows, reservationRows, expectedPlayerIds)

  if (!deal) {
    throw new Error('Catalog hand assignments are incomplete or inconsistent.')
  }

  return attachServerCatalogDeal(game, deal)
}

function commandCanResolveWithSimilarity(command: string, game: any) {
  if (command === 'resolveVotes') {
    return true
  }

  if (game?.phase !== 'debate' || game?.showdownMode !== 'similarityDuel') {
    return false
  }

  return (
    command === 'markArgumentComplete' ||
    command === 'forceCompleteArguments' ||
    command === 'completeDebate'
  )
}

async function hydrateGameWithDatabaseSimilarityScores(
  serviceClient: any,
  roomId: string,
  game: any,
  command: string,
) {
  if (!commandCanResolveWithSimilarity(command, game)) {
    return game
  }

  if (!game?.judgeWord) {
    throw new Error('Database similarity scoring requires a Judge word.')
  }

  const expectedPlayerIds = game.players
    .filter((player: any) => player.inHand && player.holeWord)
    .map((player: any) => Number(player.id))

  if (expectedPlayerIds.length === 0) {
    return game
  }

  const response = await serviceClient.rpc('score_hand_word_similarities', {
    p_room_id: roomId,
    p_hand_number: Number(game.handNumber),
    p_judge_word: game.judgeWord,
  })

  if (response.error) {
    throw new Error(`Database similarity scoring failed: ${response.error.message}`)
  }

  const scores = buildServerSimilarityScores(response.data ?? [], expectedPlayerIds)

  if (!scores) {
    throw new Error('Database similarity scoring returned incomplete hand results.')
  }

  return attachServerSimilarityScores(game, scores)
}

function hasDealablePlayers(game: any) {
  return game?.players?.filter((player: any) => player.inHand).length >= 2
}

async function persistCatalogHand({
  serviceClient,
  roomId,
  userId,
  expectedVersion,
  nextGame,
  nextStatus,
}: {
  serviceClient: any
  roomId: string
  userId: string
  expectedVersion: number
  nextGame: any
  nextStatus: string | null
}) {
  const playerIds = nextGame.players
    .filter((player: any) => player.inHand)
    .map((player: any) => Number(player.id))
  const stateToSave = sanitizeGameForRoomState(nextGame)
  const response = await serviceClient.rpc('deal_catalog_hand', {
    p_room_id: roomId,
    p_hand_number: Number(nextGame.handNumber),
    p_expected_version: Number(expectedVersion),
    p_player_ids: playerIds,
    p_state_json: stateToSave,
    p_updated_by: userId,
    p_next_status: nextStatus,
    p_embedding_model: 'word2vec-google-news-300',
  })

  if (response.error) {
    throw new Error(`Database catalog dealing failed: ${response.error.message}`)
  }

  if (!response.data?.roomState || !response.data?.room) {
    throw new Error('Database catalog dealing returned an incomplete room result.')
  }

  return {
    roomState: response.data.roomState,
    room: response.data.room,
  }
}

async function revealPublicWords(serviceClient: any, roomId: string, game: any) {
  const publicPlayerIds = getPublicRevealPlayerIds(game)

  if (publicPlayerIds.length === 0) {
    return
  }

  const { error } = await serviceClient
    .from('hand_words')
    .update({ is_revealed: true })
    .eq('room_id', roomId)
    .eq('hand_number', Number(game.handNumber))
    .in('player_id', publicPlayerIds)

  if (error) {
    throw new Error(error.message)
  }
}

async function saveGameState({
  serviceClient,
  roomId,
  userId,
  expectedVersion,
  nextGame,
  nextStatus = null,
}: {
  serviceClient: any
  roomId: string
  userId: string
  expectedVersion: number
  nextGame: any
  nextStatus?: string | null
}) {
  const stateToSave = sanitizeGameForRoomState(nextGame)

  const { data: savedRoomState, error: saveError } = await serviceClient
    .from('room_states')
    .update({
      version: Number(expectedVersion) + 1,
      state_json: stateToSave,
      updated_by: userId,
    })
    .eq('room_id', roomId)
    .eq('version', expectedVersion)
    .select('room_id, version, state_json, updated_by, updated_at')
    .maybeSingle()

  if (saveError) throw new Error(saveError.message)
  if (!savedRoomState) throw new Error('Room state changed on another device. Please try again.')

  let savedRoom = null
  if (nextStatus) {
    const { data: room, error: roomError } = await serviceClient
      .from('rooms')
      .update({ status: nextStatus })
      .eq('id', roomId)
      .select('id, code, host_user_id, status, max_players, created_at, updated_at')
      .maybeSingle()

    if (roomError) throw new Error(roomError.message)
    savedRoom = room
  }

  await revealPublicWords(serviceClient, roomId, nextGame)

  return {
    roomState: savedRoomState,
    room: savedRoom,
  }
}

async function fetchVotesForResolution(serviceClient: any, game: any, roomId: string) {
  const handNumber = Number(game.handNumber)
  const playerVoteVoterIds = getPlayerVoteVoterIds(game)
  const judgeId = game.judgePlayerId === null || game.judgePlayerId === undefined ? null : Number(game.judgePlayerId)

  const { data: voteRows, error } = await serviceClient
    .from('showdown_votes')
    .select('vote_type, voter_player_id, target_player_id')
    .eq('room_id', roomId)
    .eq('hand_number', handNumber)

  if (error) throw new Error(error.message)

  const rows = voteRows ?? []
  const playerVoteRows = rows.filter((row) => row.vote_type === 'player')
  const judgeVoteRows = rows.filter((row) => row.vote_type === 'judge')

  for (const voterId of playerVoteVoterIds) {
    if (!playerVoteRows.some((row) => Number(row.voter_player_id) === voterId)) {
      throw new Error('Waiting for all player votes.')
    }
  }

  if (judgeId !== null && !judgeVoteRows.some((row) => Number(row.voter_player_id) === judgeId)) {
    throw new Error('Waiting for judge vote.')
  }

  return rows.filter((row) => {
    if (row.vote_type === 'player') {
      return playerVoteVoterIds.includes(Number(row.voter_player_id))
    }

    return judgeId !== null && Number(row.voter_player_id) === judgeId
  })
}

async function fetchSuccessfulCommandReceipt(
  serviceClient: any,
  roomId: string,
  actorUserId: string,
  commandId: string,
) {
  const { data, error } = await serviceClient
    .from('room_actions')
    .select('action_type, response_json, version_after')
    .eq('room_id', roomId)
    .eq('actor_user_id', actorUserId)
    .eq('command_id', commandId)
    .eq('accepted', true)
    .maybeSingle()

  if (error) {
    throw new Error(`Unable to load command receipt: ${error.message}`)
  }

  return data ?? null
}

async function recordSuccessfulCommand({
  serviceClient,
  roomId,
  actorUserId,
  commandId,
  command,
  payload,
  responseBody,
  versionBefore,
  versionAfter,
}: {
  serviceClient: any
  roomId: string
  actorUserId: string
  commandId: string
  command: string
  payload: any
  responseBody: any
  versionBefore: number
  versionAfter: number
}) {
  const { error } = await serviceClient.from('room_actions').insert({
    room_id: roomId,
    actor_user_id: actorUserId,
    action_type: command,
    payload: payload ?? {},
    accepted: true,
    error_text: null,
    version_before: versionBefore,
    version_after: versionAfter,
    command_id: commandId,
    response_json: responseBody,
  })

  if (!error) {
    return responseBody
  }

  if (error.code === '23505') {
    const priorReceipt = await fetchSuccessfulCommandReceipt(
      serviceClient,
      roomId,
      actorUserId,
      commandId,
    )

    if (priorReceipt?.response_json) {
      if (priorReceipt.action_type !== command) {
        throw new Error('Command id was already used for another command.')
      }

      return priorReceipt.response_json
    }
  }

  throw new Error(`Unable to record command receipt: ${error.message}`)
}

async function recordRejectedCommand({
  serviceClient,
  roomId,
  actorUserId,
  command,
  errorCode,
  versionBefore,
}: {
  serviceClient: any
  roomId: string
  actorUserId: string
  command: string
  errorCode: string
  versionBefore: number | null
}) {
  const { error } = await serviceClient.from('room_actions').insert({
    room_id: roomId,
    actor_user_id: actorUserId,
    action_type: command || 'unknown',
    payload: {},
    accepted: false,
    error_text: errorCode,
    version_before: versionBefore,
    version_after: null,
    command_id: null,
    response_json: null,
  })

  if (error) {
    console.error(JSON.stringify({
      event: 'game_action_audit_failure',
      errorCode: 'command_audit_write_failed',
    }))
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  const requestStartedAt = performance.now()
  const timings: Record<string, number> = {}
  let serviceClient: any = null
  let actorUserId = ''
  let roomId = ''
  let command = ''
  let commandId = ''
  let payload: any = {}
  let versionBefore: number | null = null
  let membershipVerified = false

  try {
    if (req.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed.' }, 405)
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      throw new Error('Supabase Edge Function environment is not configured.')
    }

    const body = await measureStage(timings, 'requestParse', () => req.json())
    roomId = String(body.roomId ?? '')
    command = String(body.command ?? '')
    commandId = normalizeCommandId(body.commandId)
    payload = body.payload ?? {}

    if (!roomId) {
      throw new Error('Room id is required.')
    }

    const user = await measureStage(timings, 'authentication', () => {
      return requireSupabaseUser(req, supabaseUrl, anonKey)
    })
    actorUserId = user.id
    serviceClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
      },
    })

    const context = await measureStage(timings, 'actionContext', () => {
      return fetchGameActionContext(serviceClient, roomId, actorUserId, commandId)
    })
    const { room, roomPlayers, roomState, wordRows, reservationRows, receipt } = context
    versionBefore = Number(roomState.version)
    const currentMember = roomPlayers.find((player) => player.user_id === user.id)

    if (!currentMember) {
      throw new Error('Room membership required.')
    }
    membershipVerified = true

    if (receipt?.response_json) {
      if (receipt.action_type !== command) {
        throw new Error('Command id was already used for another command.')
      }

      logCommandResult({
        command,
        replayed: true,
        startedAt: requestStartedAt,
        status: 'accepted',
        timings,
      })
      return jsonResponse(receipt.response_json)
    }

    const isHost = room.host_user_id === user.id
    const stateJson = roomState.state_json
    let nextGame: any
    let nextStatus: string | null = null
    let replaceWords = false

    if (command === 'startGame') {
      if (!isHost) {
        throw new Error('Only the room host can start the online game.')
      }

      if (roomPlayers.length < 3) {
        throw new Error('Need at least 3 players to start this game mode.')
      }

      nextGame = measureSyncStage(timings, 'stateTransition', () => {
        return createInitialGame({
          playerNames: getRoomPlayerNames(roomPlayers),
          startingStack: payload.startingStack ?? STARTING_STACK,
          ante: payload.ante ?? ANTE,
          bigBlind: payload.bigBlind ?? MIN_BET,
        })
      })
      nextStatus = 'playing'
      replaceWords = true
    } else {
      if (room.status !== 'playing') {
        throw new Error('Room is not currently playing.')
      }

      if (!stateJson || !Array.isArray(stateJson.players)) {
        throw new Error('No active game state found.')
      }

      const hydratedGame = await measureStage(timings, 'privateHydration', () => {
        return hydrateGameWithPrivateHand(stateJson, wordRows, reservationRows)
      })
      const fullGame = await measureStage(timings, 'similarityHydration', () => {
        return hydrateGameWithDatabaseSimilarityScores(serviceClient, roomId, hydratedGame, command)
      })

      if (command === 'playerAction') {
        const actingSeatIndex = Number(fullGame.currentPlayerIndex)
        if (Number(currentMember.seat_index) !== actingSeatIndex) {
          throw new Error('It is not your turn yet.')
        }

        nextGame = measureSyncStage(timings, 'stateTransition', () => {
          return applyPlayerAction(fullGame, payload.type, Number(payload.amount))
        })
      } else if (command === 'markArgumentComplete') {
        const playerId = Number(payload.playerId)

        if (Number(currentMember.seat_index) !== playerId) {
          throw new Error('Players can only mark their own argument.')
        }

        nextGame = measureSyncStage(timings, 'stateTransition', () => {
          return markArgumentComplete(fullGame, playerId, payload.phaseKey ?? null)
        })
      } else if (command === 'forceCompleteArguments') {
        if (!isHost) {
          throw new Error('Only the room host can override argument tracking.')
        }

        nextGame = measureSyncStage(timings, 'stateTransition', () => {
          return forceCompleteArguments(fullGame, payload.phaseKey ?? null)
        })
      } else if (command === 'completeDebate') {
        if (!isHost) {
          throw new Error('Only the room host can advance closing arguments.')
        }

        nextGame = measureSyncStage(timings, 'stateTransition', () => {
          return completeDebateStage(fullGame, { force: Boolean(payload.force) })
        })
      } else if (command === 'resolveVotes') {
        const voteRows = await measureStage(timings, 'voteHydration', () => {
          return fetchVotesForResolution(serviceClient, fullGame, roomId)
        })
        nextGame = measureSyncStage(timings, 'stateTransition', () => {
          return resolveShowdownVotes(fullGame, buildVotesPayload(voteRows))
        })
      } else if (command === 'startNextHand') {
        if (!isHost) {
          throw new Error('Only the room host can start the next hand.')
        }

        nextGame = measureSyncStage(timings, 'stateTransition', () => {
          return startNextHand(fullGame)
        })
        replaceWords = true
      } else if (command === 'startNewGame') {
        if (!isHost) {
          throw new Error('Only the room host can start a new game.')
        }

        nextGame = measureSyncStage(timings, 'stateTransition', () => {
          return createInitialGame({
            playerNames: getRoomPlayerNames(roomPlayers),
            startingStack: payload.startingStack ?? STARTING_STACK,
            ante: payload.ante ?? ANTE,
            bigBlind: payload.bigBlind ?? MIN_BET,
          })
        })
        replaceWords = true
      } else {
        throw new Error(`Unknown game command: ${command}`)
      }
    }

    let saved

    if (replaceWords && hasDealablePlayers(nextGame)) {
      if (nextGame.phase !== 'preflop') {
        throw new Error('Catalog dealing cannot persist a hand that already advanced beyond preflop.')
      }

      saved = await measureStage(timings, 'persistence', () => {
        return persistCatalogHand({
          serviceClient,
          roomId,
          userId: user.id,
          expectedVersion: Number(roomState.version),
          nextGame,
          nextStatus,
        })
      })
    } else {
      saved = await measureStage(timings, 'persistence', () => {
        return saveGameState({
          serviceClient,
          roomId,
          userId: user.id,
          expectedVersion: Number(roomState.version),
          nextGame,
          nextStatus,
        })
      })
    }

    const responseBody = {
      roomState: saved.roomState,
      room: saved.room ?? room,
    }
    const finalResponseBody = await measureStage(timings, 'commandReceipt', () => {
      return recordSuccessfulCommand({
        serviceClient,
        roomId,
        actorUserId,
        commandId,
        command,
        payload,
        responseBody,
        versionBefore: Number(roomState.version),
        versionAfter: Number(saved.roomState.version),
      })
    })

    logCommandResult({
      command,
      replayed: finalResponseBody !== responseBody,
      startedAt: requestStartedAt,
      status: 'accepted',
      timings,
    })
    return jsonResponse(finalResponseBody)
  } catch (error) {
    const errorCode = classifyCommandError(error)

    if (serviceClient && actorUserId && roomId && commandId) {
      try {
        const receipt = await measureStage(timings, 'receiptRecovery', () => {
          return fetchSuccessfulCommandReceipt(serviceClient, roomId, actorUserId, commandId)
        })

        if (receipt?.response_json && receipt.action_type === command) {
          logCommandResult({
            command,
            replayed: true,
            startedAt: requestStartedAt,
            status: 'accepted',
            timings,
          })
          return jsonResponse(receipt.response_json)
        }
      } catch {
        // Preserve the original command error when receipt recovery is unavailable.
      }
    }

    if (serviceClient && actorUserId && roomId && membershipVerified) {
      await measureStage(timings, 'rejectionAudit', () => {
        return recordRejectedCommand({
          serviceClient,
          roomId,
          actorUserId,
          command,
          errorCode,
          versionBefore,
        })
      })
    }

    logCommandResult({
      command,
      errorCode,
      startedAt: requestStartedAt,
      status: 'rejected',
      timings,
    })
    return jsonResponse(
      {
        error: error instanceof Error ? error.message : 'Game command failed.',
      },
      400,
    )
  }
})
