import { expect, test } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

// Auth responses contain session tokens, so this live-backend regression records
// only screenshots, never a network trace or authentication response artifacts.
test.use({ trace: 'off', video: 'off' })

const PLAYER_NAMES = ['QAHost', 'QAAlex', 'QABlair', 'QACasey']

function createAdminClient() {
  const { SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: key } = process.env
  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for test-account cleanup.')
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

async function roomVersions(players) {
  return Promise.all(players.map(async ({ page }) => {
    const label = await page.locator('.online-room-connection').getAttribute('aria-label')
    return Number(label?.match(/^(?:Live|Polling) · v(\d+)$/)?.[1])
  }))
}

async function synchronize(players, after = -1) {
  await expect.poll(async () => {
    const versions = await roomVersions(players)
    return versions.every((version) => Number.isFinite(version) && version === versions[0] && version > after)
  }, { message: 'All four clients should receive the same updated room state', timeout: 30_000 }).toBe(true)
}

async function act(players, page, action) {
  const before = (await roomVersions(players))[0]
  await action()
  await synchronize(players, before)
  await expect(page.locator('[role="alert"]:visible')).toHaveCount(0)
}

async function checkUntilArguments(players, title) {
  const host = players[0].page
  for (let turn = 0; turn < PLAYER_NAMES.length; turn += 1) {
    if (await host.getByRole('dialog', { name: title, exact: true }).count()) break
    const actorName = await host.locator('.turn-panel').getAttribute('data-actor-name')
    const actor = players.find(({ name }) => name === actorName)
    expect(actor, 'The current actor must be one of the four test players').toBeDefined()
    await act(players, actor.page, () => actor.page.getByRole('button', { name: 'Check', exact: true }).click())
  }
  await Promise.all(players.map(({ page }) => {
    return expect(page.getByRole('dialog', { name: title, exact: true })).toBeVisible()
  }))
}

async function finishArguments(players, title) {
  let marked = 0
  for (const { page } of players) {
    const button = page.getByRole('button', { name: 'Mark Argued', exact: true })
    if (await button.count()) {
      await act(players, page, () => button.click())
      marked += 1
    }
  }
  expect(marked).toBe(3)
  await Promise.all(players.map(({ page }) => {
    return expect(page.getByRole('dialog', { name: title, exact: true })).toHaveCount(0)
  }))
}

async function scrollActions(page) {
  const scrollTop = await page.getByRole('region', { name: 'Game actions', exact: true }).evaluate((element) => {
    element.scrollTop = element.scrollHeight
    return element.scrollTop
  })
  expect(scrollTop, 'The voting panel must be scrolled before testing its transition').toBeGreaterThan(0)
  return scrollTop
}

async function cleanupAccounts(admin, userIds, roomCode) {
  // IDs come only from fresh anonymous signup responses in these isolated contexts.
  // Never enumerate or delete other members who might have joined the test room.
  const results = await Promise.all([...userIds].map((id) => admin.auth.admin.deleteUser(id)))
  expect(results.filter(({ error }) => error && error.code !== 'user_not_found')).toHaveLength(0)
  if (roomCode) {
    const { data, error } = await admin.from('rooms').select('id').eq('code', roomCode).maybeSingle()
    expect(error).toBeNull()
    expect(data, 'Deleting the temporary host should cascade through its room').toBeNull()
  }
}

test('@voting-results empty votes stay disabled and results reset scroll for four online players', async ({
  browser,
  baseURL,
}, testInfo) => {
  test.setTimeout(180_000)
  const admin = createAdminClient()
  const players = []
  const userIds = new Set()
  const pendingSignups = []
  let roomCode = ''

  try {
    for (const [index, name] of PLAYER_NAMES.entries()) {
      const context = await browser.newContext({
        viewport: index === 2 ? { width: 390, height: 640 } : { width: 1280, height: 720 },
      })
      const page = await context.newPage()
      players.push({ name, context, page })
      page.on('response', (response) => {
        if (response.url() === `${process.env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1/signup` && response.ok()) {
          pendingSignups.push(response.json().then(({ user }) => {
            if (user?.id && user.is_anonymous) userIds.add(user.id)
          }))
        }
      })
      await page.goto(baseURL)
      await expect(page.getByLabel('Your Name', { exact: true })).toBeEnabled()
      await page.getByLabel('Your Name', { exact: true }).fill(name)
      await expect(page.getByLabel('Your Name', { exact: true })).toHaveValue(name)
    }

    const host = players[0].page
    await host.getByRole('button', { name: 'Create Room', exact: true }).click()
    await expect(host.locator('.online-room-code b')).toHaveText(/^[A-Z0-9]{6}$/)
    roomCode = (await host.locator('.online-room-code b').innerText()).trim()
    for (const { page } of players.slice(1)) {
      await page.getByLabel('Join Code', { exact: true }).fill(roomCode)
      await page.getByRole('button', { name: 'Join Room', exact: true }).click()
      await expect(page.locator('.online-room-code b')).toHaveText(roomCode)
    }
    for (const { page } of players) {
      await expect(page.locator('.online-room-seat-count')).toHaveText('4/8')
      await page.getByRole('button', { name: 'I’m ready', exact: true }).click()
      await expect(page.getByRole('button', { name: 'Ready ✓', exact: true })).toBeVisible()
    }
    await Promise.all(pendingSignups)
    expect(userIds.size, 'All four fresh anonymous accounts must be tracked for cleanup').toBe(4)
    await host.getByRole('button', { name: 'Start', exact: true }).click()
    await Promise.all(players.map(({ page }) => {
      return expect(page.getByRole('button', { name: 'Disconnect', exact: true })).toBeVisible()
    }))
    await synchronize(players)

    await checkUntilArguments(players, 'OPENING STATEMENTS')
    await finishArguments(players, 'OPENING STATEMENTS')
    await checkUntilArguments(players, 'CLOSING ARGUMENTS')
    await finishArguments(players, 'CLOSING ARGUMENTS')

    for (const player of players) {
      const { page, name } = player
      await expect(page.getByRole('heading', { name: 'Showdown Voting', exact: true })).toBeVisible()
      const judgeVote = await page.getByRole('button', { name: 'Submit Judge Vote', exact: true }).count() > 0
      const select = page.getByRole('combobox')
      const submit = page.getByRole('button', { name: judgeVote ? 'Submit Judge Vote' : 'Submit Player Vote', exact: true })
      const choices = await select.locator('option').evaluateAll((options) => {
        return options.filter((option) => option.value !== '').map(({ value, textContent }) => ({ value, textContent }))
      })
      expect(choices.length).toBeGreaterThan(0)
      if (!judgeVote) expect(choices.every(({ textContent }) => !textContent.startsWith(`${name} (`))).toBe(true)
      await expect(select).toHaveValue('')
      await expect(submit).toBeDisabled()

      // Seat zero is valid when offered; the placeholder must never coerce to it.
      const target = choices.find(({ value }) => value === '0') ?? choices[0]
      await select.selectOption(target.value)
      await expect(select).toHaveValue(target.value)
      await expect(submit).toBeEnabled()
      await select.selectOption('')
      await expect(submit).toBeDisabled()
      await select.selectOption(target.value)
      await expect(submit).toBeEnabled()
      player.submit = submit
    }

    const hostScrollTop = await scrollActions(host)
    const firstVoter = players[1]
    await act(players, firstVoter.page, () => firstVoter.submit.click())
    await expect(host.getByRole('heading', { name: 'Showdown Voting', exact: true })).toBeVisible()
    expect(await host.locator('.local-game-actionbar').evaluate((element) => element.scrollTop))
      .toBe(hostScrollTop)

    for (const player of players.filter((player) => player !== firstVoter)) {
      await act(players, player.page, () => player.submit.click())
    }
    for (const { page } of players) {
      await expect(page.getByRole('button', { name: 'Show Final Results', exact: true })).toBeEnabled()
      await scrollActions(page)
    }

    await act(players, host, () => host.getByRole('button', { name: 'Show Final Results', exact: true }).click())
    for (const { page } of players) {
      const heading = page.getByRole('heading', { name: 'Round Complete', exact: true })
      const nextRound = page.getByRole('button', { name: 'Start Next Round', exact: true })
      await expect(heading).toBeVisible()
      await expect.poll(() => page.locator('.local-game-actionbar').evaluate((element) => element.scrollTop)).toBe(0)
      await expect(heading).toBeInViewport()
      await expect(nextRound).toBeInViewport()
      await expect(page.locator('.winner-line')).toBeInViewport()
      if (page === host) await expect(nextRound).toBeEnabled()
      else await expect(nextRound).toBeDisabled()
    }
    await host.screenshot({ path: testInfo.outputPath('results-desktop.png') })
    await players[2].page.screenshot({ path: testInfo.outputPath('results-mobile.png') })
  } finally {
    await Promise.allSettled(players.map(({ context }) => context.close()))
    await Promise.allSettled(pendingSignups)
    await cleanupAccounts(admin, userIds, roomCode)
  }
})
