import { expect, test } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

const PLAYER_NAMES = ['Host', 'PlayerB', 'PlayerC']
const FOUR_PLAYER_NAMES = [...PLAYER_NAMES, 'PlayerD']
const EIGHT_PLAYER_NAMES = [
  ...FOUR_PLAYER_NAMES,
  'PlayerE',
  'PlayerF',
  'PlayerG',
  'PlayerH',
]
const ROOM_CODE_PATTERN = /^[A-Z0-9]{6}$/
const CONNECTION_PATTERN = /^(Live|Polling) · v(\d+)$/

function createAdminClient() {
  const supabaseUrl = process.env.SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required so the test can clean up its room and anonymous users.',
    )
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}

async function cleanupTestRoom(adminClient, roomCode) {
  if (!roomCode) {
    return
  }

  const roomResponse = await adminClient
    .from('rooms')
    .select('id')
    .eq('code', roomCode)
    .maybeSingle()

  if (roomResponse.error) {
    throw new Error(`Unable to find test room ${roomCode}: ${roomResponse.error.message}`)
  }

  if (!roomResponse.data) {
    return
  }

  const playersResponse = await adminClient
    .from('room_players')
    .select('user_id')
    .eq('room_id', roomResponse.data.id)

  if (playersResponse.error) {
    throw new Error(`Unable to list test players: ${playersResponse.error.message}`)
  }

  // Removing the host test user cascades through rooms and all room-owned data.
  // This uses the Auth admin API because the Data API intentionally denies direct
  // deletes on the rooms table.
  const deleteUserResults = await Promise.all(
    (playersResponse.data ?? []).map(({ user_id: userId }) => {
      return adminClient.auth.admin.deleteUser(userId)
    }),
  )
  const deleteUserError = deleteUserResults.find((result) => result.error)?.error

  if (deleteUserError) {
    throw new Error(`Unable to delete a test user: ${deleteUserError.message}`)
  }

  const remainingRoomResponse = await adminClient
    .from('rooms')
    .select('id')
    .eq('id', roomResponse.data.id)
    .maybeSingle()

  if (remainingRoomResponse.error) {
    throw new Error(`Unable to verify room cleanup: ${remainingRoomResponse.error.message}`)
  }

  if (remainingRoomResponse.data) {
    throw new Error(`Test room ${roomCode} still exists after deleting its anonymous users.`)
  }
}

async function fetchTestUserIds(adminClient, roomCode) {
  const roomResponse = await adminClient
    .from('rooms')
    .select('room_players(user_id)')
    .eq('code', roomCode)
    .maybeSingle()

  if (roomResponse.error) {
    throw new Error(`Unable to inspect test room ${roomCode}: ${roomResponse.error.message}`)
  }

  return (roomResponse.data?.room_players ?? []).map(({ user_id: userId }) => userId)
}

async function deleteTestUsers(adminClient, userIds) {
  const deleteResults = await Promise.all(
    [...userIds].map((userId) => adminClient.auth.admin.deleteUser(userId)),
  )
  const deleteError = deleteResults.find((result) => {
    return result.error && result.error.code !== 'user_not_found'
  })?.error

  if (deleteError) {
    throw new Error(`Unable to delete a stress-test user: ${deleteError.message}`)
  }
}

async function openPlayerPage(browser, baseURL, displayName) {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(baseURL)

  const nameInput = page.getByLabel('Your Name', { exact: true })
  await expect(nameInput).toBeEnabled()
  await nameInput.fill(displayName)

  return { context, page }
}

async function readConnection(page) {
  const text = (await page.locator('.online-room-connection').innerText()).trim()
  const match = text.match(CONNECTION_PATTERN)

  if (!match) {
    return { mode: 'Unknown', version: null }
  }

  return {
    mode: match[1],
    version: Number(match[2]),
  }
}

function getActingPlayerName(turnText) {
  return PLAYER_NAMES.find((name) => turnText.startsWith(`${name} to act.`)) ?? null
}

async function everyPlayerShowsSameTurn(players, previousActorName = null) {
  const turnTexts = await Promise.all(
    players.map(({ page }) => page.locator('.turn-panel > p').innerText()),
  )
  const actingPlayerName = getActingPlayerName(turnTexts[0] ?? '')

  return Boolean(
    actingPlayerName &&
      actingPlayerName !== previousActorName &&
      turnTexts.every((turnText) => turnText === turnTexts[0]),
  )
}

async function expectTurnControls(page, { enabled }) {
  const amountInput = page.getByLabel('Bet/Raise target', { exact: true })
  const foldButton = page.getByRole('button', { name: 'Fold', exact: true })

  if (enabled) {
    await expect(amountInput).toBeEnabled()
    await expect(foldButton).toBeEnabled()
    return
  }

  await expect(amountInput).toBeDisabled()

  const turnButtons = page.locator('.turn-panel button')
  await expect(turnButtons).toHaveCount(11)
  expect(await turnButtons.evaluateAll((buttons) => buttons.every((button) => button.disabled))).toBe(
    true,
  )
}

test('@rehearsal three isolated players create, join, and start a synchronized game', async ({
  browser,
  baseURL,
}) => {
  const adminClient = createAdminClient()
  const players = []
  let roomCode = ''

  try {
    for (const displayName of PLAYER_NAMES) {
      players.push(await openPlayerPage(browser, baseURL, displayName))
    }

    const [host, playerB, playerC] = players.map(({ page }) => page)
    await host.getByRole('button', { name: 'Create Room', exact: true }).click()

    const roomCodeText = host.locator('.online-room-code b')
    await expect(roomCodeText).toHaveText(ROOM_CODE_PATTERN)
    roomCode = (await roomCodeText.innerText()).trim()

    await Promise.all(
      [playerB, playerC].map(async (page) => {
        await page.getByLabel('Join Code', { exact: true }).fill(roomCode)
        await page.getByRole('button', { name: 'Join Room', exact: true }).click()
      }),
    )

    await Promise.all(
      [playerB, playerC].map((page) => {
        return expect(page.locator('.online-room-code b')).toHaveText(roomCode)
      }),
    )

    await expect
      .poll(
        () => {
          return Promise.all(
            players.map(({ page }) => page.locator('.online-room-seat-count').innerText()),
          )
        },
        {
          message: 'Host, PlayerB, and PlayerC should each see all three lobby members',
          timeout: 5_000,
        },
      )
      .toEqual(['3/8', '3/8', '3/8'])

    const startButton = host.getByRole('button', { name: 'Start', exact: true })
    await expect(startButton).toBeEnabled()
    await startButton.click()

    await Promise.all(
      players.map(({ page }) => {
        return expect(page.getByRole('button', { name: 'Disconnect', exact: true })).toBeVisible()
      }),
    )

    await expect
      .poll(
        async () => {
          const connections = await Promise.all(
            players.map(({ page }) => readConnection(page)),
          )
          const versions = connections.map(({ version }) => version)
          const modesAreHealthy = connections.every(({ mode }) => {
            return mode === 'Live' || mode === 'Polling'
          })

          return {
            modesAreHealthy,
            version: versions[0],
            versionsMatch: versions.every((version) => version === versions[0]),
          }
        },
        {
          message: 'all players should converge on the same healthy room-state version',
          timeout: 30_000,
        },
      )
      .toEqual({
        modesAreHealthy: true,
        version: 2,
        versionsMatch: true,
      })
  } finally {
    await Promise.all(players.map(({ context }) => context.close()))
    await cleanupTestRoom(adminClient, roomCode)
  }
})

test('@turn-gating only the active player can use betting controls', async ({
  browser,
  baseURL,
}) => {
  const adminClient = createAdminClient()
  const players = []
  let roomCode = ''

  try {
    for (const displayName of PLAYER_NAMES) {
      players.push(await openPlayerPage(browser, baseURL, displayName))
    }

    const [host, playerB, playerC] = players.map(({ page }) => page)
    const pagesByName = new Map(
      PLAYER_NAMES.map((name, index) => [name, players[index].page]),
    )

    await host.getByRole('button', { name: 'Create Room', exact: true }).click()

    const roomCodeText = host.locator('.online-room-code b')
    await expect(roomCodeText).toHaveText(ROOM_CODE_PATTERN)
    roomCode = (await roomCodeText.innerText()).trim()

    await Promise.all(
      [playerB, playerC].map(async (page) => {
        await page.getByLabel('Join Code', { exact: true }).fill(roomCode)
        await page.getByRole('button', { name: 'Join Room', exact: true }).click()
        await expect(page.locator('.online-room-code b')).toHaveText(roomCode)
      }),
    )

    await expect
      .poll(
        () => {
          return Promise.all(
            players.map(({ page }) => page.locator('.online-room-seat-count').innerText()),
          )
        },
        {
          message: 'all players should see all three lobby members before starting',
          timeout: 5_000,
        },
      )
      .toEqual(['3/8', '3/8', '3/8'])

    await host.getByRole('button', { name: 'Start', exact: true }).click()

    await expect
      .poll(() => everyPlayerShowsSameTurn(players), {
        message: 'all players should synchronize on the initial actor',
        timeout: 30_000,
      })
      .toBe(true)

    const initialTurnText = await host.locator('.turn-panel > p').innerText()
    const initialActorName = getActingPlayerName(initialTurnText)
    expect(initialActorName).not.toBeNull()

    for (const [playerName, page] of pagesByName) {
      await expectTurnControls(page, { enabled: playerName === initialActorName })
    }

    const initialActorPage = pagesByName.get(initialActorName)
    await initialActorPage.getByRole('button', { name: 'Fold', exact: true }).click()

    await expect
      .poll(() => everyPlayerShowsSameTurn(players, initialActorName), {
        message: 'all players should synchronize on the next actor after a fold',
        timeout: 30_000,
      })
      .toBe(true)

    const nextTurnText = await host.locator('.turn-panel > p').innerText()
    const nextActorName = getActingPlayerName(nextTurnText)
    expect(nextActorName).not.toBeNull()
    expect(nextActorName).not.toBe(initialActorName)

    for (const [playerName, page] of pagesByName) {
      await expectTurnControls(page, { enabled: playerName === nextActorName })
    }
  } finally {
    await Promise.allSettled(players.map(({ context }) => context.close()))
    await cleanupTestRoom(adminClient, roomCode)
  }
})

test('@four-player four isolated players create, join, and start a synchronized game', async ({
  browser,
  baseURL,
}) => {
  const adminClient = createAdminClient()
  const players = []
  let roomCode = ''

  try {
    for (const displayName of FOUR_PLAYER_NAMES) {
      players.push(await openPlayerPage(browser, baseURL, displayName))
    }

    const [host, ...joiningPlayers] = players.map(({ page }) => page)
    await host.getByRole('button', { name: 'Create Room', exact: true }).click()

    const roomCodeText = host.locator('.online-room-code b')
    await expect(roomCodeText).toHaveText(ROOM_CODE_PATTERN)
    roomCode = (await roomCodeText.innerText()).trim()

    await Promise.all(
      joiningPlayers.map(async (page) => {
        await page.getByLabel('Join Code', { exact: true }).fill(roomCode)
        await page.getByRole('button', { name: 'Join Room', exact: true }).click()
        await expect(page.locator('.online-room-code b')).toHaveText(roomCode)
      }),
    )

    await expect
      .poll(
        () => {
          return Promise.all(
            players.map(({ page }) => page.locator('.online-room-seat-count').innerText()),
          )
        },
        {
          message: 'Host, PlayerB, PlayerC, and PlayerD should each see all four members',
          timeout: 5_000,
        },
      )
      .toEqual(['4/8', '4/8', '4/8', '4/8'])

    const startButton = host.getByRole('button', { name: 'Start', exact: true })
    await expect(startButton).toBeEnabled()
    await startButton.click()

    await Promise.all(
      players.map(({ page }) => {
        return expect(page.getByRole('button', { name: 'Disconnect', exact: true })).toBeVisible()
      }),
    )

    await expect
      .poll(
        async () => {
          const connections = await Promise.all(
            players.map(({ page }) => readConnection(page)),
          )
          const versions = connections.map(({ version }) => version)
          const modesAreHealthy = connections.every(({ mode }) => {
            return mode === 'Live' || mode === 'Polling'
          })

          return {
            modesAreHealthy,
            version: versions[0],
            versionsMatch: versions.every((version) => version === versions[0]),
          }
        },
        {
          message: 'all four players should converge on the same healthy room-state version',
          timeout: 30_000,
        },
      )
      .toEqual({
        modesAreHealthy: true,
        version: 2,
        versionsMatch: true,
      })
  } finally {
    await Promise.allSettled(players.map(({ context }) => context.close()))
    await cleanupTestRoom(adminClient, roomCode)
  }
})

test('@eight-player eight isolated players fill a room and start a synchronized game', async ({
  browser,
  baseURL,
}) => {
  const adminClient = createAdminClient()
  const players = []
  let roomCode = ''

  try {
    for (const displayName of EIGHT_PLAYER_NAMES) {
      players.push(await openPlayerPage(browser, baseURL, displayName))
    }

    const [host, ...joiningPlayers] = players.map(({ page }) => page)
    await host.getByRole('button', { name: 'Create Room', exact: true }).click()

    const roomCodeText = host.locator('.online-room-code b')
    await expect(roomCodeText).toHaveText(ROOM_CODE_PATTERN)
    roomCode = (await roomCodeText.innerText()).trim()

    await Promise.all(
      joiningPlayers.map(async (page) => {
        await page.getByLabel('Join Code', { exact: true }).fill(roomCode)
        await page.getByRole('button', { name: 'Join Room', exact: true }).click()
        await expect(page.locator('.online-room-code b')).toHaveText(roomCode)
      }),
    )

    await expect
      .poll(
        () => {
          return Promise.all(
            players.map(({ page }) => page.locator('.online-room-seat-count').innerText()),
          )
        },
        {
          message: 'all eight players should see a full eight-player lobby',
          timeout: 15_000,
        },
      )
      .toEqual(Array(8).fill('8/8'))

    const startButton = host.getByRole('button', { name: 'Start', exact: true })
    await expect(startButton).toBeEnabled()
    await startButton.click()

    await Promise.all(
      players.map(({ page }) => {
        return expect(page.getByRole('button', { name: 'Disconnect', exact: true })).toBeVisible()
      }),
    )

    await expect
      .poll(
        async () => {
          const connections = await Promise.all(
            players.map(({ page }) => readConnection(page)),
          )
          const versions = connections.map(({ version }) => version)
          const modesAreHealthy = connections.every(({ mode }) => {
            return mode === 'Live' || mode === 'Polling'
          })

          return {
            modesAreHealthy,
            version: versions[0],
            versionsMatch: versions.every((version) => version === versions[0]),
          }
        },
        {
          message: 'all eight players should converge on the same healthy room-state version',
          timeout: 30_000,
        },
      )
      .toEqual({
        modesAreHealthy: true,
        version: 2,
        versionsMatch: true,
      })
  } finally {
    await Promise.allSettled(players.map(({ context }) => context.close()))
    await cleanupTestRoom(adminClient, roomCode)
  }
})

test('@stress three isolated players converge across ten consecutive lobbies', async ({
  browser,
  baseURL,
}) => {
  const adminClient = createAdminClient()
  const players = []
  const testUserIds = new Set()
  let roomCode = ''

  try {
    for (const displayName of PLAYER_NAMES) {
      players.push(await openPlayerPage(browser, baseURL, displayName))
    }

    const [host, playerB, playerC] = players.map(({ page }) => page)

    for (let cycle = 1; cycle <= 10; cycle += 1) {
      await host.getByRole('button', { name: 'Create Room', exact: true }).click()

      const roomCodeText = host.locator('.online-room-code b')
      await expect(roomCodeText).toHaveText(ROOM_CODE_PATTERN)
      roomCode = (await roomCodeText.innerText()).trim()

      await Promise.all(
        [playerB, playerC].map(async (page) => {
          await page.getByLabel('Join Code', { exact: true }).fill(roomCode)
          await page.getByRole('button', { name: 'Join Room', exact: true }).click()
          await expect(page.locator('.online-room-code b')).toHaveText(roomCode)
        }),
      )

      await expect
        .poll(
          () => {
            return Promise.all(
              players.map(({ page }) => page.locator('.online-room-seat-count').innerText()),
            )
          },
          {
            message: `cycle ${cycle}: every player should see all three lobby members`,
            timeout: 5_000,
          },
        )
        .toEqual(['3/8', '3/8', '3/8'])

      await expect(host.getByRole('button', { name: 'Start', exact: true })).toBeEnabled()

      for (const userId of await fetchTestUserIds(adminClient, roomCode)) {
        testUserIds.add(userId)
      }

      await Promise.all(
        [playerB, playerC].map((page) => {
          return page.getByRole('button', { name: 'Leave', exact: true }).click()
        }),
      )
      await Promise.all(
        [playerB, playerC].map((page) => {
          return expect(
            page.getByRole('button', { name: 'Create Room', exact: true }),
          ).toBeEnabled()
        }),
      )

      await host.getByRole('button', { name: 'Leave', exact: true }).click()
      await expect(host.getByRole('button', { name: 'Create Room', exact: true })).toBeEnabled()
      roomCode = ''
    }
  } finally {
    await Promise.allSettled(players.map(({ context }) => context.close()))

    if (roomCode) {
      await cleanupTestRoom(adminClient, roomCode)
    }

    await deleteTestUsers(adminClient, testUserIds)
  }
})
