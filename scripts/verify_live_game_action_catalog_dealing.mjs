#!/usr/bin/env node

import { randomUUID } from 'node:crypto'
import process from 'node:process'
import { createClient } from '@supabase/supabase-js'

function requireEnvironment(name) {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} is required.`)
  }
  return value
}

function unwrapSingleRow(data) {
  return Array.isArray(data) ? (data[0] ?? null) : (data ?? null)
}

function requireNoError(response, label) {
  if (response.error) {
    throw new Error(`${label}: ${response.error.message}`)
  }
  return response.data
}

async function invokeGameCommand(
  client,
  roomId,
  command,
  payload = {},
  commandId = randomUUID(),
) {
  const response = await client.functions.invoke('game-action', {
    body: { roomId, command, commandId, payload },
  })

  if (response.error) {
    let message = response.error.message
    const context = response.error.context

    if (context && typeof context.clone === 'function') {
      try {
        const body = await context.clone().json()
        message = body?.error ?? body?.message ?? message
      } catch {
        // Preserve the client error when no JSON response is available.
      }
    }

    throw new Error(`${command}: ${message}`)
  }

  if (response.data?.error || !response.data?.roomState) {
    throw new Error(`${command}: ${response.data?.error ?? 'missing room state'}`)
  }

  return response.data
}

async function loadCatalogHand(serviceClient, roomId, handNumber, dealVersion) {
  const words = requireNoError(
    await serviceClient
      .from('hand_words')
      .select('player_id, word, catalog_word_id, deal_version, is_revealed')
      .eq('room_id', roomId)
      .eq('hand_number', handNumber)
      .order('player_id'),
    `Load hand ${handNumber}`,
  )
  const reservation = requireNoError(
    await serviceClient.rpc('get_catalog_hand_reservation', {
      p_room_id: roomId,
      p_hand_number: handNumber,
      p_deal_version: dealVersion,
    }),
    `Load hand ${handNumber} neutral reservation`,
  )

  if (words.length !== 3 || reservation.length !== 1) {
    throw new Error(`Hand ${handNumber} does not contain three player words and one neutral word.`)
  }

  const catalogIds = [
    ...words.map((row) => Number(row.catalog_word_id)),
    Number(reservation[0].catalog_word_id),
  ]
  if (
    words.some((row) => Number(row.deal_version) !== dealVersion) ||
    catalogIds.some((id) => !Number.isInteger(id) || id < 1) ||
    new Set(catalogIds).size !== 4
  ) {
    throw new Error(`Hand ${handNumber} has incomplete or repeated catalog assignments.`)
  }

  return {
    words,
    reservation: reservation[0],
    catalogIds,
  }
}

function assertPublicStateIsPrivate(state) {
  if (
    state.players.some((player) => player.holeWord) ||
    Object.hasOwn(state, '__serverNeutralJudgeWord') ||
    Object.hasOwn(state, '__serverCatalogDealVersion')
  ) {
    throw new Error('Preflop public room state exposed private catalog deal data.')
  }
}

async function playChecksUntilPhaseChanges(clientsBySeat, roomId, initialState, phase) {
  let state = initialState

  for (let actionCount = 0; actionCount < 12 && state.phase === phase; actionCount += 1) {
    const actorId = Number(state.currentPlayerIndex)
    const actorClient = clientsBySeat.get(actorId)
    if (!actorClient) {
      throw new Error(`No browser session exists for acting player ${actorId}.`)
    }

    const commandId = randomUUID()
    const result = await invokeGameCommand(actorClient, roomId, 'playerAction', {
      type: 'check',
      amount: 0,
    }, commandId)

    if (actionCount === 0) {
      const replay = await invokeGameCommand(actorClient, roomId, 'playerAction', {
        type: 'check',
        amount: 0,
      }, commandId)

      if (Number(replay.roomState.version) !== Number(result.roomState.version)) {
        throw new Error('Idempotent command replay advanced the room state twice.')
      }
    }

    state = result.roomState.state_json
  }

  if (state.phase === phase) {
    throw new Error(`The ${phase} checking round did not advance.`)
  }

  return state
}

async function main() {
  const supabaseUrl = requireEnvironment('SUPABASE_URL')
  const publishableKey = requireEnvironment('VITE_SUPABASE_PUBLISHABLE_KEY')
  const serviceRoleKey = requireEnvironment('SUPABASE_SERVICE_ROLE_KEY')
  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const sessions = []
  let roomId = null

  try {
    for (const displayName of ['VerifyA', 'VerifyB', 'VerifyC']) {
      const client = createClient(supabaseUrl, publishableKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      })
      const signIn = await client.auth.signInAnonymously()
      if (signIn.error || !signIn.data.user) {
        throw new Error(`Create ${displayName} session: ${signIn.error?.message ?? 'missing user'}`)
      }
      sessions.push({ client, displayName, userId: signIn.data.user.id, seatIndex: null })
    }

    const createRoomData = requireNoError(
      await sessions[0].client.rpc('create_room', {
        p_display_name: sessions[0].displayName,
        p_max_players: 3,
      }),
      'Create temporary room',
    )
    const createdRoom = unwrapSingleRow(createRoomData)
    roomId = createdRoom?.room_id
    const roomCode = createdRoom?.room_code
    sessions[0].seatIndex = Number(createdRoom?.seat_index)
    if (!roomId || !roomCode) {
      throw new Error('Temporary room creation returned no room id or code.')
    }

    for (const session of sessions.slice(1)) {
      const joinData = requireNoError(
        await session.client.rpc('join_room', {
          p_room_code: roomCode,
          p_display_name: session.displayName,
        }),
        `Join ${session.displayName}`,
      )
      session.seatIndex = Number(unwrapSingleRow(joinData)?.seat_index)
    }

    const clientsBySeat = new Map(sessions.map((session) => [session.seatIndex, session.client]))
    const started = await invokeGameCommand(sessions[0].client, roomId, 'startGame', {
      startingStack: 400,
      ante: 10,
      bigBlind: 10,
    })
    let state = started.roomState.state_json

    if (state.phase !== 'preflop' || Number(state.handNumber) !== 1) {
      throw new Error('Fresh catalog game did not begin at hand 1 preflop.')
    }
    assertPublicStateIsPrivate(state)

    const firstDealVersion = Number(started.roomState.version)
    const firstHand = await loadCatalogHand(serviceClient, roomId, 1, firstDealVersion)

    for (const session of sessions) {
      const accessibleWords = requireNoError(
        await session.client
          .from('hand_words')
          .select('player_id, word, is_revealed')
          .eq('room_id', roomId)
          .eq('hand_number', 1),
        `Read ${session.displayName} private word`,
      )
      if (
        accessibleWords.length !== 1 ||
        Number(accessibleWords[0].player_id) !== session.seatIndex ||
        accessibleWords[0].is_revealed
      ) {
        throw new Error(`${session.displayName} could access another preflop word.`)
      }
    }

    state = await playChecksUntilPhaseChanges(clientsBySeat, roomId, state, 'preflop')
    if (state.phase !== 'postflop' || !state.judgeWord || state.judgePlayerId === null) {
      throw new Error('Preflop did not produce a live player Judge word.')
    }

    const judgeId = Number(state.judgePlayerId)
    const contenderIds = state.players
      .filter((player) => player.inHand && !player.folded && !player.isJudge)
      .map((player) => Number(player.id))
    if (contenderIds.length !== 2) {
      throw new Error('Expected two contenders in the three-player verification hand.')
    }

    const scoreRows = requireNoError(
      await serviceClient.rpc('score_hand_word_similarities', {
        p_room_id: roomId,
        p_hand_number: 1,
        p_judge_word: state.judgeWord,
      }),
      'Score live Judge word',
    )
    if (
      scoreRows.length !== 3 ||
      scoreRows.some((row) => !Number.isFinite(Number(row.score))) ||
      Math.abs(Number(scoreRows.find((row) => Number(row.player_id) === judgeId)?.score) - 100) > 0.01
    ) {
      throw new Error('Live Judge scoring did not return three complete finite scores.')
    }

    const contenderSession = sessions.find((session) => session.seatIndex === contenderIds[0])
    const visibleAfterJudge = requireNoError(
      await contenderSession.client
        .from('hand_words')
        .select('player_id, word, is_revealed')
        .eq('room_id', roomId)
        .eq('hand_number', 1),
      'Verify Judge reveal privacy',
    )
    if (
      visibleAfterJudge.length !== 2 ||
      !visibleAfterJudge.some((row) => Number(row.player_id) === judgeId && row.is_revealed)
    ) {
      throw new Error('Judge reveal did not expose exactly the viewer word and live Judge word.')
    }

    for (const contenderId of contenderIds) {
      const result = await invokeGameCommand(
        clientsBySeat.get(contenderId),
        roomId,
        'markArgumentComplete',
        { playerId: contenderId, phaseKey: 'opening' },
      )
      state = result.roomState.state_json
    }

    state = await playChecksUntilPhaseChanges(clientsBySeat, roomId, state, 'postflop')
    if (state.phase !== 'debate') {
      throw new Error('Postflop did not advance to closing arguments.')
    }

    for (const contenderId of contenderIds) {
      const result = await invokeGameCommand(
        clientsBySeat.get(contenderId),
        roomId,
        'markArgumentComplete',
        { playerId: contenderId, phaseKey: 'closing' },
      )
      state = result.roomState.state_json
    }

    if (state.phase !== 'showdownVoting') {
      throw new Error('Closing arguments did not advance to showdown voting.')
    }

    for (const voterId of contenderIds) {
      const targetId = contenderIds.find((contenderId) => contenderId !== voterId)
      requireNoError(
        await clientsBySeat.get(voterId).rpc('submit_showdown_vote', {
          p_room_id: roomId,
          p_hand_number: 1,
          p_voter_player_id: voterId,
          p_vote_type: 'player',
          p_target_player_id: targetId,
        }),
        `Submit player vote for seat ${voterId}`,
      )
    }
    requireNoError(
      await clientsBySeat.get(judgeId).rpc('submit_showdown_vote', {
        p_room_id: roomId,
        p_hand_number: 1,
        p_voter_player_id: judgeId,
        p_vote_type: 'judge',
        p_target_player_id: contenderIds[0],
      }),
      'Submit Judge vote',
    )

    const resolved = await invokeGameCommand(sessions[0].client, roomId, 'resolveVotes')
    state = resolved.roomState.state_json
    if (state.phase !== 'handComplete' || !state.showdown?.winner) {
      throw new Error('The live catalog-backed hand did not resolve successfully.')
    }

    const secondStarted = await invokeGameCommand(sessions[0].client, roomId, 'startNextHand')
    const secondState = secondStarted.roomState.state_json
    if (secondState.phase !== 'preflop' || Number(secondState.handNumber) !== 2) {
      throw new Error('The second catalog-backed hand did not start normally.')
    }
    assertPublicStateIsPrivate(secondState)

    const secondHand = await loadCatalogHand(
      serviceClient,
      roomId,
      2,
      Number(secondStarted.roomState.version),
    )
    if (firstHand.catalogIds.some((catalogId) => secondHand.catalogIds.includes(catalogId))) {
      throw new Error('The second live hand repeated a word from the current room cycle.')
    }

    console.log('Edge deal check: fresh public room received three catalog-backed private words')
    console.log('Privacy check: preflop clients saw only their own word; Judge reveal exposed no contender word')
    console.log('Scoring check: live Judge word returned three complete finite database scores')
    console.log('Lifecycle check: betting, arguments, voting, and payout completed successfully')
    console.log('Shuffle-cycle check: the second hand used four new catalog words')
  } finally {
    for (const session of [...sessions].reverse()) {
      const deletion = await serviceClient.auth.admin.deleteUser(session.userId)
      if (deletion.error) {
        console.warn(`Unable to remove temporary user ${session.displayName}: ${deletion.error.message}`)
      }
    }

    if (roomId) {
      const roomCheck = await serviceClient.from('rooms').select('id').eq('id', roomId).maybeSingle()
      if (roomCheck.error) {
        console.warn(`Unable to verify temporary room cleanup: ${roomCheck.error.message}`)
      } else if (roomCheck.data) {
        console.warn('Temporary room still exists after test-user cleanup.')
      } else {
        console.log('Cleanup check: temporary room and anonymous users removed')
      }
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
