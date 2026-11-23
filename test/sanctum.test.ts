import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { diffSnapshots, lastPlayedCharacter, toSnapshot } from '../src/core/sanctum/inventory'
import { parseCurrencyOverview, valueLoot } from '../src/core/sanctum/prices'
import { normalizeCookie, PoeSite, SiteError } from '../src/main/poe-site'
import { PriceBook } from '../src/main/prices'
import { SanctumService } from '../src/main/sanctum'
import { SecretStore, type Cipher } from '../src/main/secrets'

const COOKIE = '0123456789abcdef0123456789abcdef'

/** Builds a site answer shaped like the real one. */
function siteAnswer(inventory: Record<string, unknown>[], gold = 100) {
  return {
    character: { class: 'Assassin', level: 82, league: 'Covens', name: 'Tester' },
    inventory: { gold },
    items: [
      { id: 'worn-1', inventoryId: 'BodyArmour', name: 'Doom Shell', typeLine: 'Astral Plate' },
      { id: 'flask-1', inventoryId: 'Flask', typeLine: 'Quicksilver Flask' },
      ...inventory.map((item) => ({ inventoryId: 'MainInventory', ...item }))
    ]
  }
}

const stack = (typeLine: string, stackSize: number, id = `${typeLine}-${stackSize}`) => ({ id, typeLine, stackSize, maxStackSize: 20 })
const single = (id: string, typeLine: string, name = '') => ({ id, typeLine, name })

const ninjaAnswer = {
  lines: [
    { currencyTypeName: 'Divine Orb', chaosEquivalent: 120 },
    { currencyTypeName: 'Orb of Annulment', chaosEquivalent: 6, pay: null },
    // Cheap currency: listed at the 1-chaos floor, really 12 of them to the chaos.
    { currencyTypeName: 'Orb of Fusing', chaosEquivalent: 1, pay: { value: 12 } },
    // At the floor with nothing to correct it by: price unknown.
    { currencyTypeName: 'Scroll of Wisdom', chaosEquivalent: 1, pay: null },
    // A stray reverse listing must not override a price that is clearly above the floor.
    { currencyTypeName: 'Exalted Orb', chaosEquivalent: 3, pay: { value: 4 } },
    { currencyTypeName: 'Broken Thing', chaosEquivalent: 0 }
  ]
}

describe('toSnapshot', () => {
  it('keeps only the main inventory, summing stacks and keeping single items by id', () => {
    const snapshot = toSnapshot(
      siteAnswer([stack('Chaos Orb', 19), stack('Chaos Orb', 20), single('r1', 'Topaz Ring', "Valako's Sign"), single('rel', 'Urn Relic')], 108661),
      1000
    )!
    expect(snapshot).toMatchObject({ takenAt: 1000, league: 'Covens', characterClass: 'Assassin', level: 82, gold: 108661 })
    expect(snapshot.stacks).toEqual({ 'Chaos Orb': 39 })
    expect(snapshot.singles).toEqual({ r1: "Valako's Sign Topaz Ring", rel: 'Urn Relic' })
  })

  it('reports missing gold as unknown rather than zero', () => {
    const answer = siteAnswer([])
    delete (answer as { inventory?: unknown }).inventory
    expect(toSnapshot(answer, 0)!.gold).toBeNull()
  })

  it('rejects answers that are not a character', () => {
    expect(toSnapshot(false, 0)).toBeNull()
    expect(toSnapshot({ error: { code: 1 } }, 0)).toBeNull()
  })
})

describe('lastPlayedCharacter', () => {
  it('picks the character with the latest login', () => {
    expect(lastPlayedCharacter([{ name: 'A', lastLoginTime: 5 }, { name: 'B', lastLoginTime: 9 }, { name: 'C', lastLoginTime: 7 }])).toBe('B')
  })
  it('skips malformed entries and rejects answers that are not a list', () => {
    expect(lastPlayedCharacter([{ name: 'A' }, { lastLoginTime: 9 }, { name: 'B', lastLoginTime: 1 }])).toBe('B')
    expect(lastPlayedCharacter(false)).toBeNull()
    expect(lastPlayedCharacter([])).toBeNull()
  })
})

describe('diffSnapshots', () => {
  const before = toSnapshot(siteAnswer([stack('Chaos Orb', 10), stack('Vaal Orb', 6), single('old', 'Urn Relic')], 100), 0)!

  it('counts grown stacks, new stacks, new single items and gold', () => {
    const after = toSnapshot(
      siteAnswer(
        [stack('Chaos Orb', 20), stack('Chaos Orb', 5), stack('Vaal Orb', 6), stack('Divine Orb', 2), single('old', 'Urn Relic'), single('new1', 'Urn Relic'), single('new2', 'Urn Relic')],
        350
      ),
      1
    )!
    const loot = diffSnapshots(before, after)
    expect(loot.gold).toBe(250)
    expect(Object.fromEntries(loot.lines.map((line) => [line.name, line.count]))).toEqual({
      'Chaos Orb': 15,
      'Divine Orb': 2,
      'Urn Relic': 2
    })
  })

  it('ignores what was spent, dropped or stashed', () => {
    const after = toSnapshot(siteAnswer([stack('Chaos Orb', 3)], 40), 1)!
    expect(diffSnapshots(before, after)).toEqual({ gold: 0, lines: [] })
  })

  it('does not treat a rearranged inventory as loot', () => {
    // The same 10 chaos split into two stacks, the relic moved: ids and totals are unchanged.
    const after = toSnapshot(siteAnswer([stack('Chaos Orb', 4), stack('Chaos Orb', 6), stack('Vaal Orb', 6), single('old', 'Urn Relic')], 100), 1)!
    expect(diffSnapshots(before, after)).toEqual({ gold: 0, lines: [] })
  })
})

describe('prices', () => {
  const prices = parseCurrencyOverview(ninjaAnswer, 'Covens', 5)!

  it('reads prices, adds Chaos Orb as the unit and skips worthless lines', () => {
    expect(prices).toMatchObject({ league: 'Covens', fetchedAt: 5, divineChaos: 120 })
    expect(prices.chaosByName).toEqual({
      'Chaos Orb': 1,
      'Divine Orb': 120,
      'Orb of Annulment': 6,
      'Orb of Fusing': 1 / 12,
      'Exalted Orb': 3
    })
    expect(parseCurrencyOverview({ nope: true }, 'Covens', 0)).toBeNull()
  })

  it('values loot in chaos and divines, leaving unknown items out of the sum', () => {
    const value = valueLoot(
      { gold: 7, lines: [{ name: 'Chaos Orb', count: 30 }, { name: 'Divine Orb', count: 2 }, { name: 'Urn Relic', count: 1 }] },
      prices
    )
    expect(value).toMatchObject({ gold: 7, chaos: 270, divine: 2.25, unpriced: 1 })
    expect(value.lines.map((line) => [line.name, line.chaos])).toEqual([['Divine Orb', 240], ['Chaos Orb', 30], ['Urn Relic', null]])
  })

  it('still lists the loot when there are no prices at all', () => {
    const value = valueLoot({ gold: 0, lines: [{ name: 'Divine Orb', count: 1 }] }, null)
    expect(value).toMatchObject({ chaos: 0, divine: null, unpriced: 1 })
  })
})

describe('normalizeCookie', () => {
  it('accepts the bare value or the copied "name=value" form', () => {
    expect(normalizeCookie(`  ${COOKIE.toUpperCase()} `)).toBe(COOKIE)
    expect(normalizeCookie(`POESESSID=${COOKIE}; path=/`)).toBe(COOKIE)
  })
  it('rejects anything else', () => {
    expect(normalizeCookie('hello')).toBeNull()
    expect(normalizeCookie(COOKIE.slice(1))).toBeNull()
  })
})

// ── Pieces that touch the outside world, with the outside replaced ──

const cipher = (available = true): Cipher => ({
  isEncryptionAvailable: () => available,
  encryptString: (plain) => Buffer.from(`enc:${plain}`),
  decryptString: (encrypted) => {
    const text = encrypted.toString()
    if (!text.startsWith('enc:')) throw new Error('bad')
    return text.slice(4)
  }
})

const respond = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers })

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sanctum-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('SecretStore', () => {
  it('stores secrets encrypted and reads them back', () => {
    const file = join(dir, 'secrets.json')
    const store = new SecretStore(file, cipher())
    expect(store.set('poesessid', COOKIE)).toBe(true)
    expect(readFileSync(file, 'utf8')).not.toContain(COOKIE)
    expect(new SecretStore(file, cipher()).get('poesessid')).toBe(COOKIE)
    store.delete('poesessid')
    expect(store.has('poesessid')).toBe(false)
  })

  it('refuses to store anything when the system cannot encrypt', () => {
    const file = join(dir, 'secrets.json')
    const store = new SecretStore(file, cipher(false))
    expect(store.set('poesessid', COOKIE)).toBe(false)
    expect(store.has('poesessid')).toBe(false)
  })
})

describe('PoeSite', () => {
  it('asks the site for the character with the cookie, and only that site', async () => {
    const calls: { url: string; cookie: string | null }[] = []
    const site = new PoeSite({
      fetch: (async (url: URL, init: RequestInit) => {
        calls.push({ url: String(url), cookie: new Headers(init.headers).get('cookie') })
        return respond(siteAnswer([]))
      }) as unknown as typeof fetch
    })
    await site.getItems('Name#1234', 'Some Char', COOKIE)
    expect(calls).toEqual([
      {
        url: 'https://www.pathofexile.com/character-window/get-items?accountName=Name%231234&character=Some+Char&realm=pc',
        cookie: `POESESSID=${COOKIE}`
      }
    ])
  })

  it('spaces requests out', async () => {
    let now = 10_000
    const slept: number[] = []
    const site = new PoeSite({
      fetch: (async () => respond(siteAnswer([]))) as unknown as typeof fetch,
      now: () => now,
      sleep: async (ms) => {
        slept.push(ms)
        now += ms
      }
    })
    await site.getItems('a', 'b', COOKIE)
    now += 1000
    await site.getItems('a', 'b', COOKIE)
    expect(slept).toEqual([1500])
  })

  it('explains refused access, unknown characters and network failures', async () => {
    const failing = (status: number) => new PoeSite({ fetch: (async () => respond({}, status)) as unknown as typeof fetch })
    await expect(failing(403).getItems('a', 'b', COOKIE)).rejects.toMatchObject({ kind: 'auth' })
    await expect(failing(404).getItems('a', 'b', COOKIE)).rejects.toMatchObject({ kind: 'not-found' })
    const offline = new PoeSite({ fetch: (async () => { throw new Error('offline') }) as unknown as typeof fetch })
    await expect(offline.getItems('a', 'b', COOKIE)).rejects.toBeInstanceOf(SiteError)
  })

  it('stops asking while the site says to wait', async () => {
    let now = 0
    let requests = 0
    const site = new PoeSite({
      fetch: (async () => {
        requests++
        return respond({}, 429, { 'retry-after': '60' })
      }) as unknown as typeof fetch,
      now: () => now,
      sleep: async () => {}
    })
    await expect(site.getItems('a', 'b', COOKIE)).rejects.toMatchObject({ kind: 'rate-limit' })
    now = 30_000
    await expect(site.getItems('a', 'b', COOKIE)).rejects.toThrow(/ещё 30 с/)
    expect(requests).toBe(1)
  })
})

describe('PriceBook', () => {
  it('fetches once, reuses the cache for an hour and survives a restart', async () => {
    let now = 0
    let requests = 0
    const fetcher = (async () => {
      requests++
      return respond(ninjaAnswer)
    }) as unknown as typeof fetch
    const file = join(dir, 'prices.json')
    const book = new PriceBook(file, fetcher, () => now)
    expect((await book.get('Covens')).divineChaos).toBe(120)
    now = 30 * 60 * 1000
    await new PriceBook(file, fetcher, () => now).get('Covens')
    expect(requests).toBe(1)
    now = 61 * 60 * 1000
    await book.get('Covens')
    expect(requests).toBe(2)
  })

  it('falls back to stale prices when poe.ninja is down, and fails only with none', async () => {
    let now = 0
    let down = false
    const fetcher = (async () => (down ? respond({}, 500) : respond(ninjaAnswer))) as unknown as typeof fetch
    const book = new PriceBook(join(dir, 'prices.json'), fetcher, () => now)
    await book.get('Covens')
    down = true
    now = 2 * 60 * 60 * 1000
    expect((await book.get('Covens')).divineChaos).toBe(120)
    await expect(book.get('Standard')).rejects.toThrow(/500/)
  })
})

describe('SanctumService', () => {
  function setup(answers: unknown[], options: { encryption?: boolean; characters?: () => unknown } = {}) {
    const queue = [...answers]
    const asked: string[] = []
    const site = new PoeSite({
      fetch: (async (url: URL) => {
        asked.push(`${url.pathname.split('/').pop()} ${url.searchParams.get('character') ?? ''}`.trim())
        // The list of characters is answered separately, so the queue only holds inventories.
        if (url.pathname.endsWith('get-characters')) return respond(options.characters?.() ?? [])
        const next = queue.shift()
        return next instanceof Response ? next : respond(next)
      }) as unknown as typeof fetch,
      sleep: async () => {}
    })
    const views: boolean[] = []
    const service = new SanctumService({
      file: join(dir, 'account.json'),
      runsFile: join(dir, 'runs.json'),
      sleep: async () => {},
      site,
      secrets: new SecretStore(join(dir, 'secrets.json'), cipher(options.encryption ?? true)),
      prices: new PriceBook(join(dir, 'prices.json'), (async () => respond(ninjaAnswer)) as unknown as typeof fetch),
      onChange: (view) => views.push(view.busy)
    })
    return { service, views, asked }
  }

  const access = { account: 'Name#1234', character: 'Tester', autoCharacter: false, cookie: COOKIE }
  const autoAccess = { account: 'Name#1234', character: '', autoCharacter: true, cookie: COOKIE }
  const roster = (latest: string) => [
    { name: 'OldOne', lastLoginTime: 100 },
    { name: latest, lastLoginTime: 300 },
    { name: 'Middle', lastLoginTime: 200 }
  ]

  it('saves the access settings, checks them and reports what it found', async () => {
    const { service, views } = setup([siteAnswer([stack('Chaos Orb', 5)], 42)])
    await service.saveAccess(access)
    const view = service.view()
    expect(view).toMatchObject({ account: 'Name#1234', character: 'Tester', autoCharacter: false, cookieStored: true, busy: false })
    expect(view.status).toEqual({ ok: true, message: expect.stringMatching(/Tester — Assassin 82 ур\., лига Covens.*позиций: 1, золото: 42/) })
    expect(views[views.length - 1]).toBe(false)
    expect(JSON.stringify(view)).not.toContain(COOKIE)
  })

  it('rejects a malformed cookie without asking the site', async () => {
    const { service } = setup([])
    await service.saveAccess({ ...access, cookie: 'nonsense' })
    expect(service.view()).toMatchObject({ cookieStored: false, status: { ok: false } })
  })

  it('does not keep the cookie when it cannot be encrypted', async () => {
    const { service } = setup([], { encryption: false })
    await service.saveAccess(access)
    expect(service.view()).toMatchObject({ cookieStored: false, canStoreCookie: false, status: { ok: false } })
  })

  it('values what was gained between two snapshots', async () => {
    const { service } = setup([
      siteAnswer([]),
      siteAnswer([stack('Chaos Orb', 5)], 100),
      siteAnswer([stack('Chaos Orb', 15), stack('Divine Orb', 1), single('rel', 'Urn Relic')], 400)
    ])
    await service.saveAccess(access)
    await service.snapshot()
    expect(service.view().lastLoot).toBeNull()
    await service.snapshot()
    const view = service.view()
    expect(view.snapshots).toHaveLength(2)
    expect(view.lastLoot).toMatchObject({ gold: 300, chaos: 130, unpriced: 1 })
    expect(view.prices).toMatchObject({ league: 'Covens', divineChaos: 120 })
  })

  it('reports a refused request and is not left busy', async () => {
    const { service } = setup([siteAnswer([]), respond({}, 403)])
    await service.saveAccess(access)
    await service.snapshot()
    expect(service.view()).toMatchObject({ busy: false, status: { ok: false, message: expect.stringMatching(/cookie устарела/) } })
  })

  it('remembers the account between runs and forgets the cookie on request', async () => {
    const first = setup([siteAnswer([])])
    await first.service.saveAccess(access)
    const second = setup([])
    expect(second.service.view()).toMatchObject({ account: 'Name#1234', character: 'Tester', cookieStored: true })
    second.service.clearCookie()
    expect(second.service.view().cookieStored).toBe(false)
  })

  it('picks the character that logged in last when asked to choose automatically', async () => {
    const { service, asked } = setup([siteAnswer([])], { characters: () => roster('Fresh') })
    await service.saveAccess(autoAccess)
    expect(service.view()).toMatchObject({ character: 'Fresh', autoCharacter: true, status: { ok: true } })
    expect(asked).toEqual(['get-characters', 'get-items Fresh'])
    // The choice is remembered, so the tab shows it right away after a restart.
    expect(setup([]).service.view()).toMatchObject({ character: 'Fresh', autoCharacter: true })
  })

  it('explains when the site returns no characters for the account', async () => {
    const { service } = setup([], { characters: () => false })
    await service.saveAccess(autoAccess)
    expect(service.view()).toMatchObject({ character: '', status: { ok: false, message: expect.stringMatching(/список персонажей/) } })
  })

  it('follows a switch to another character at the start of the next run, once per run', async () => {
    let current = 'First'
    const { service, asked } = setup(
      [siteAnswer([]), siteAnswer([], 0), siteAnswer([stack('Chaos Orb', 3)], 0), siteAnswer([stack('Divine Orb', 9)], 0)],
      { characters: () => roster(current) }
    )
    await service.saveAccess(autoAccess)
    asked.length = 0

    // Run one on the first character: one look-up, then inventories.
    service.onArea(1000, 'SanctumFoyer_1_1', 'run-1')
    service.onArea(2000, 'SanctumCellar', 'room')
    service.onArea(3000, 'SanctumFoyer_Fellshrine', 'lobby')
    await service.settled()
    expect(asked).toEqual(['get-characters', 'get-items First', 'get-items First'])
    expect(service.view().active?.run.loot.chaos).toBe(3)

    // The player logs in as someone else and starts over: nine divines there are not loot.
    current = 'Second'
    asked.length = 0
    service.onArea(4000, 'SanctumFoyer_1_2', 'run-2')
    await service.settled()
    expect(asked).toEqual(['get-characters', 'get-items Second'])
    expect(service.view().character).toBe('Second')
    expect(service.view().active?.run.loot).toMatchObject({ chaos: 0, lines: [] })
  })

  // ── Runs ──

  const T0 = new Date(2026, 10, 23, 10, 0, 0).getTime()
  const sec = (seconds: number): number => T0 + seconds * 1000

  /** Plays a whole floor: entrance, eight rooms ten seconds apart, then the lobby. Returns the time after it. */
  function playFloor(service: SanctumService, floor: number, start: number, run = 'a'): number {
    const room = ['SanctumCellar', 'SanctumVaults', 'SanctumNave', 'SanctumCrypt'][floor - 1]
    service.onArea(sec(start), `SanctumFoyer_${floor}_1`, `${run}-entrance-${floor}`)
    for (let i = 0; i < 8; i++) service.onArea(sec(start + 10 + i * 10), room, `${run}-${floor}-${i}`)
    return start + 90
  }

  it('books the loot of each floor from the inventory read at its end', async () => {
    const { service } = setup([
      siteAnswer([]), // access check
      siteAnswer([stack('Chaos Orb', 5)], 100), // baseline at the start of the run
      siteAnswer([stack('Chaos Orb', 15)], 300), // after floor 1
      siteAnswer([stack('Chaos Orb', 15), stack('Divine Orb', 2)], 300) // after floor 2
    ])
    await service.saveAccess(access)

    let t = playFloor(service, 1, 0)
    service.onArea(sec(t), 'SanctumFoyer_Fellshrine', 'lobby')
    t = playFloor(service, 2, t + 5)
    service.onArea(sec(t), 'SanctumFoyer_Fellshrine', 'lobby')
    await service.settled()

    const { active } = service.view()
    expect(active?.run.floors.map((floor) => [floor.floor, floor.rooms, floor.ms, floor.done])).toEqual([
      [1, 8, 90_000, true],
      [2, 8, 90_000, false]
    ])
    expect(active?.run.floors[0].loot).toMatchObject({ gold: 200, chaos: 10 })
    expect(active?.run.floors[1].loot).toMatchObject({ gold: 0, chaos: 240, divine: 2 })
    expect(active?.run.loot).toMatchObject({ gold: 200, chaos: 250 })
    expect(active).toMatchObject({ floor: null, inSanctum: true })
  })

  it('finishes a won run, keeps it in history and counts it in the statistics', async () => {
    const { service } = setup([
      siteAnswer([]),
      siteAnswer([], 0),
      ...[1, 2, 3, 4].map((floor) => siteAnswer([stack('Divine Orb', floor)], floor * 100))
    ])
    await service.saveAccess(access)
    let t = 0
    for (const floor of [1, 2, 3, 4]) {
      t = playFloor(service, floor, t)
      if (floor === 4) service.onDialogue(sec(t - 5), 'Lycia, Herald of the Scourge', '*laughter*')
      service.onArea(sec(t), 'SanctumFoyer_Fellshrine', 'lobby')
      t += 5
    }
    await service.settled()

    const view = service.view()
    expect(view.active).toBeNull()
    expect(view.runs).toHaveLength(1)
    expect(view.runs[0]).toMatchObject({ outcome: 'completed', durationMs: 4 * 90_000 + 3 * 5_000, lootNote: null })
    expect(view.runs[0].loot).toMatchObject({ gold: 400, chaos: 480, divine: 4 })
    expect(view.stats.session).toMatchObject({
      runs: 1,
      completed: 1,
      failed: 0,
      avgRunMs: 375_000,
      avgFloorMs: 90_000,
      avgFloorMsByFloor: [90_000, 90_000, 90_000, 90_000],
      sanctumMs: 375_000,
      chaos: 480,
      divine: 4,
      gold: 400,
      chaosOrbs: 0,
      divineOrbs: 4
    })

    // The history survives a restart; a new session starts its own statistics.
    const reopened = setup([]).service.view()
    expect(reopened.runs).toHaveLength(1)
    expect(reopened.stats.allTime.runs).toBe(1)
    expect(reopened.stats.session.runs).toBe(0)
  })

  it('tracks runs without loot when access is not set up, and says so', async () => {
    const { service } = setup([])
    playFloor(service, 1, 0)
    service.failActive()
    await service.settled()
    const [run] = service.view().runs
    expect(run).toMatchObject({ outcome: 'failed', lootNote: expect.stringMatching(/не настроен доступ/) })
    expect(run.loot).toMatchObject({ chaos: 0, lines: [] })
    expect(service.view().stats.session).toMatchObject({ runs: 1, completed: 0, failed: 1, avgRunMs: null, avgFloorMs: null })
  })

  it('lets the player correct how a run ended', async () => {
    const { service } = setup([])
    playFloor(service, 1, 0)
    service.failActive()
    const [run] = service.view().runs
    service.setOutcome(run.id, 'completed')
    expect(service.view().runs[0]).toMatchObject({ outcome: 'completed' })
    expect(service.view().runs[0].floors[0].done).toBe(true)
    expect(service.view().stats.session).toMatchObject({ completed: 1, failed: 0 })
    service.setOutcome(run.id, 'failed')
    expect(service.view().runs[0].floors[0].done).toBe(false)
  })

  it('closes a run left in progress by the previous launch as failed', async () => {
    const first = setup([])
    playFloor(first.service, 1, 0)
    const reopened = setup([]).service.view()
    expect(reopened.active).toBeNull()
    expect(reopened.runs[0]).toMatchObject({ outcome: 'failed', durationMs: 80_000 })
  })

  it('starts session statistics over on request', async () => {
    const { service } = setup([])
    playFloor(service, 1, 0)
    service.failActive()
    service.newSession()
    expect(service.view().stats.session.runs).toBe(0)
    expect(service.view().stats.allTime.runs).toBe(1)
  })
})
