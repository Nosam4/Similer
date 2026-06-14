import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.106.2'
import {
  applyPlayerAction,
  completeDebateStage,
  createInitialGame,
  resolveShowdownVotes,
  startNextHand,
} from '../_shared/wordgame/engine.js'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const STARTING_STACK = 400
const SMALL_BLIND = 5
const BIG_BLIND = 10
const PUBLIC_WORD_PHASES = new Set(['debate', 'showdownVoting', 'handComplete'])

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json',
    },
  })
}

function randomFloat() {
  const values = new Uint32Array(1)
  crypto.getRandomValues(values)
  return values[0] / 0x100000000
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
  const sanitized = cloneGame(game)
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

function extractPrivateHandWords(game: any) {
  return game.players
    .filter((player: any) => player.inHand && player.holeWord)
    .map((player: any) => ({
      playerId: player.id,
      word: player.holeWord,
    }))
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

function getRoomPlayerNames(roomPlayers: any[]) {
  return [...roomPlayers]
    .sort((left, right) => left.seat_index - right.seat_index)
    .map((player) => String(player.display_name).trim())
    .filter(Boolean)
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

async function fetchRoomBundle(serviceClient: any, roomId: string) {
  const [{ data: room, error: roomError }, { data: roomPlayers, error: playersError }, { data: roomState, error: stateError }] = await Promise.all([
    serviceClient
      .from('rooms')
      .select('id, code, host_user_id, status, max_players, created_at, updated_at')
      .eq('id', roomId)
      .maybeSingle(),
    serviceClient
      .from('room_players')
      .select('room_id, user_id, display_name, seat_index, is_ready, joined_at')
      .eq('room_id', roomId)
      .order('seat_index', { ascending: true }),
    serviceClient
      .from('room_states')
      .select('room_id, version, state_json, updated_by, updated_at')
      .eq('room_id', roomId)
      .maybeSingle(),
  ])

  if (roomError) throw new Error(roomError.message)
  if (playersError) throw new Error(playersError.message)
  if (stateError) throw new Error(stateError.message)
  if (!room) throw new Error('Room not found.')
  if (!roomState) throw new Error('Room state not found.')

  return {
    room,
    roomPlayers: roomPlayers ?? [],
    roomState,
  }
}

async function fetchPrivateHandWords(serviceClient: any, roomId: string, handNumber: number) {
  const { data, error } = await serviceClient
    .from('hand_words')
    .select('player_id, word')
    .eq('room_id', roomId)
    .eq('hand_number', handNumber)

  if (error) {
    throw new Error(error.message)
  }

  return data ?? []
}

async function replacePrivateHandWords(serviceClient: any, roomId: string, game: any, roomPlayers: any[]) {
  const handNumber = Number(game.handNumber)
  const seatToUserId = new Map(roomPlayers.map((player) => [Number(player.seat_index), player.user_id]))
  const privateWords = extractPrivateHandWords(game)

  const { error: deleteWordsError } = await serviceClient
    .from('hand_words')
    .delete()
    .eq('room_id', roomId)
    .eq('hand_number', handNumber)

  if (deleteWordsError) throw new Error(deleteWordsError.message)

  const { error: deleteVotesError } = await serviceClient
    .from('showdown_votes')
    .delete()
    .eq('room_id', roomId)
    .eq('hand_number', handNumber)

  if (deleteVotesError) throw new Error(deleteVotesError.message)

  if (privateWords.length === 0) {
    return
  }

  const rows = privateWords.map((wordRow) => {
    const userId = seatToUserId.get(Number(wordRow.playerId))
    if (!userId) {
      throw new Error(`Unable to map player ${wordRow.playerId} to a room seat.`)
    }

    return {
      room_id: roomId,
      hand_number: handNumber,
      player_id: wordRow.playerId,
      user_id: userId,
      word: wordRow.word,
      is_revealed: false,
    }
  })

  const { error: insertError } = await serviceClient.from('hand_words').insert(rows)
  if (insertError) throw new Error(insertError.message)
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

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

    const user = await requireSupabaseUser(req, supabaseUrl, anonKey)
    const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
      },
    })

    const body = await req.json()
    const roomId = String(body.roomId ?? '')
    const command = String(body.command ?? '')
    const payload = body.payload ?? {}

    if (!roomId) {
      throw new Error('Room id is required.')
    }

    const { room, roomPlayers, roomState } = await fetchRoomBundle(serviceClient, roomId)
    const currentMember = roomPlayers.find((player) => player.user_id === user.id)

    if (!currentMember) {
      throw new Error('Room membership required.')
    }

    const isHost = room.host_user_id === user.id
    const stateJson = roomState.state_json
    const rng = randomFloat
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

      nextGame = createInitialGame({
        playerNames: getRoomPlayerNames(roomPlayers),
        startingStack: payload.startingStack ?? STARTING_STACK,
        smallBlind: payload.smallBlind ?? SMALL_BLIND,
        bigBlind: payload.bigBlind ?? BIG_BLIND,
        rng,
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

      const wordRows = await fetchPrivateHandWords(serviceClient, roomId, Number(stateJson.handNumber))
      const fullGame = hydrateGameWithWords(stateJson, wordRows)

      if (command === 'playerAction') {
        const actingSeatIndex = Number(fullGame.currentPlayerIndex)
        if (Number(currentMember.seat_index) !== actingSeatIndex) {
          throw new Error('It is not your turn yet.')
        }

        nextGame = applyPlayerAction(fullGame, payload.type, Number(payload.amount))
      } else if (command === 'completeDebate') {
        const currentSeatIndex = Number(currentMember.seat_index)
        const currentPlayer = fullGame.players.find((player: any) => Number(player.id) === currentSeatIndex)
        const canCompleteDebate =
          currentPlayer?.isJudge ||
          Boolean(currentPlayer?.inHand && !currentPlayer?.folded && !currentPlayer?.isJudge)

        if (!canCompleteDebate) {
          throw new Error('Only the judge or active contenders can complete debate.')
        }

        nextGame = completeDebateStage(fullGame)
      } else if (command === 'resolveVotes') {
        const voteRows = await fetchVotesForResolution(serviceClient, fullGame, roomId)
        nextGame = resolveShowdownVotes(fullGame, buildVotesPayload(voteRows))
      } else if (command === 'startNextHand') {
        if (!isHost) {
          throw new Error('Only the room host can start the next hand.')
        }

        nextGame = startNextHand(fullGame, { rng })
        replaceWords = true
      } else if (command === 'startNewGame') {
        if (!isHost) {
          throw new Error('Only the room host can start a new game.')
        }

        nextGame = createInitialGame({
          playerNames: getRoomPlayerNames(roomPlayers),
          startingStack: payload.startingStack ?? STARTING_STACK,
          smallBlind: payload.smallBlind ?? SMALL_BLIND,
          bigBlind: payload.bigBlind ?? BIG_BLIND,
          rng,
        })
        replaceWords = true
      } else {
        throw new Error(`Unknown game command: ${command}`)
      }
    }

    if (replaceWords) {
      await replacePrivateHandWords(serviceClient, roomId, nextGame, roomPlayers)
    }

    const saved = await saveGameState({
      serviceClient,
      roomId,
      userId: user.id,
      expectedVersion: Number(roomState.version),
      nextGame,
      nextStatus,
    })

    return jsonResponse({
      roomState: saved.roomState,
      room: saved.room ?? room,
    })
  } catch (error) {
    return jsonResponse(
      {
        error: error instanceof Error ? error.message : 'Game command failed.',
      },
      400,
    )
  }
})
