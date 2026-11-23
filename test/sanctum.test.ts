import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { diffSnapshots, lastPlayedCharacter, toSnapshot } from '../src/core/sanctum/inventory'
import { combinePrices, parseExchangeOverview, valueLoot } from '../src/core/sanctum/prices'
import { normalizeCookie, PoeSite, SiteError } from '../src/main/poe-site'
import { PriceBook } from '../src/main/prices'
import { SanctumService, type SanctumDeps } from '../src/main/sanctum'
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

const stack = (typeLine: string, stackSize: number, id = `${typeLine}-${stackSize}`) => ({
  id,
  typeLine,
  stackSize,
  maxStackSize: 20,
  frameType: 5,
  icon: `https://web.poecdn.com/inventory/${typeLine.replace(/ /g, '')}.png`
})
const single = (id: string, typeLine: string, name = '') => ({ id, typeLine, name })

/** An answer shaped like poe.ninja's exchange overview for the "Currency" category. */
const ninjaAnswer = {
  core: {
    primary: 'chaos',
    secondary: 'divine',
    items: [
      { id: 'chaos', name: 'Chaos Orb', image: '/gen/image/chaos.png' },
      { id: 'divine', name: 'Divine Orb', image: '/gen/image/divine.png' }
    ]
  },
  lines: [
    { id: 'divine', primaryValue: 120 },
    { id: 'annul', primaryValue: 6 },
    { id: 'fusing', primaryValue: 0.125 },
    { id: 'volatile', primaryValue: 600 },
    { id: 'worthless', primaryValue: 0 },
    { id: 'unknown-item', primaryValue: 5 }
  ],
  items: [
    { id: 'divine', name: 'Divine Orb', image: '/gen/image/divine.png' },
    { id: 'annul', name: 'Orb of Annulment', image: '/gen/image/annul.png' },
    { id: 'fusing', name: 'Orb of Fusing', image: '/gen/image/fusing.png' },
    { id: 'volatile', name: 'Volatile Vaal Orb', image: '/gen/image/volatile.png' },
    { id: 'worthless', name: 'Broken Thing', image: '/gen/image/broken.png' }
  ]
}
/** A second category, to check that categories are merged. */
const fragmentAnswer = {
  core: { primary: 'chaos', items: [] },
  lines: [{ id: 'crest', primaryValue: 40 }],
  items: [{ id: 'crest', name: "Baran's Crest", image: '/gen/image/crest.png' }]
}
/** Answers a poe.ninja request by category: currency, fragments, and nothing else. */
const ninjaFetch = (onRequest: () => void = () => {}) =>
  (async (url: URL) => {
    onRequest()
    const type = url.searchParams.get('type')
    return respond(type === 'Currency' ? ninjaAnswer : type === 'Fragment' ? fragmentAnswer : { core: { primary: 'chaos' }, lines: [], items: [] })
  }) as unknown as typeof fetch
const CATEGORY_COUNT = 15

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
  const before = toSnapshot(siteAnswer([stack('Chaos Orb', 10), stack('Vaal Orb', 6), single('old', 'Topaz Ring')], 100), 0)!

  it('counts grown stacks, new stacks, new single items and gold', () => {
    const after = toSnapshot(
      siteAnswer(
        [stack('Chaos Orb', 20), stack('Chaos Orb', 5), stack('Vaal Orb', 6), stack('Divine Orb', 2), single('old', 'Topaz Ring'), single('new1', 'Topaz Ring'), single('new2', 'Topaz Ring')],
        350
      ),
      1
    )!
    const loot = diffSnapshots(before, after)
    expect(loot.gold).toBe(250)
    expect(Object.fromEntries(loot.lines.map((line) => [line.name, line.count]))).toEqual({
      'Chaos Orb': 15,
      'Divine Orb': 2,
      'Topaz Ring': 2
    })
  })

  it('ignores what was spent, dropped or stashed', () => {
    const after = toSnapshot(siteAnswer([stack('Chaos Orb', 3)], 40), 1)!
    expect(diffSnapshots(before, after)).toEqual({ gold: 0, lines: [] })
  })

  it('does not treat a rearranged inventory as loot', () => {
    // The same 10 chaos split into two stacks, the relic moved: ids and totals are unchanged.
    const after = toSnapshot(siteAnswer([stack('Chaos Orb', 4), stack('Chaos Orb', 6), stack('Vaal Orb', 6), single('old', 'Topaz Ring')], 100), 1)!
    expect(diffSnapshots(before, after)).toEqual({ gold: 0, lines: [] })
  })
})

describe('prices', () => {
  const prices = combinePrices([parseExchangeOverview(ninjaAnswer)!, parseExchangeOverview(fragmentAnswer)!], 'Covens', 5)

  it('reads prices in chaos with fractions, adds Chaos Orb as the unit and skips worthless lines', () => {
    expect(prices).toMatchObject({ league: 'Covens', fetchedAt: 5, divineChaos: 120 })
    expect(prices.chaosByName).toEqual({
      'Chaos Orb': 1,
      'Divine Orb': 120,
      'Orb of Annulment': 6,
      'Orb of Fusing': 0.125,
      'Volatile Vaal Orb': 600,
      "Baran's Crest": 40
    })
  })

  it('collects pictures for every listed item, as full addresses', () => {
    expect(prices.icons['Volatile Vaal Orb']).toBe('https://web.poecdn.com/gen/image/volatile.png')
    expect(prices.icons['Chaos Orb']).toBe('https://web.poecdn.com/gen/image/chaos.png')
    expect(Object.keys(prices.icons)).toHaveLength(7)
  })

  it('rejects answers of another shape or priced in another currency', () => {
    expect(parseExchangeOverview({ nope: true })).toBeNull()
    expect(parseExchangeOverview({ ...ninjaAnswer, core: { primary: 'divine' } })).toBeNull()
  })

  const line = (name: string, count: number, currency = true) => ({ name, count, icon: null, currency })

  it('values loot in chaos and divines, leaving unknown items out of the sum', () => {
    const value = valueLoot({ gold: 7, lines: [line('Chaos Orb', 30), line('Volatile Vaal Orb', 3), line('Urn Relic', 1, false)] }, prices)
    expect(value).toMatchObject({ gold: 7, chaos: 1830, divine: 15.25, unpriced: 1 })
    expect(value.lines.map((entry) => [entry.name, entry.chaos])).toEqual([
      ['Volatile Vaal Orb', 1800],
      ['Chaos Orb', 30],
      ['Urn Relic', null]
    ])
  })

  it('fills in a missing picture from the price list and keeps the currency flag', () => {
    const [orb] = valueLoot({ gold: 0, lines: [line('Divine Orb', 1)] }, prices).lines
    expect(orb).toMatchObject({ icon: 'https://web.poecdn.com/gen/image/divine.png', currency: true })
  })

  it('still lists the loot when there are no prices at all', () => {
    const value = valueLoot({ gold: 0, lines: [line('Divine Orb', 1)] }, null)
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
  const quick = { sleep: async () => {} }

  it('downloads every category once, reuses the cache for an hour and survives a restart', async () => {
    let now = 0
    let requests = 0
    const fetcher = ninjaFetch(() => requests++)
    const file = join(dir, 'prices.json')
    const book = new PriceBook(file, { fetch: fetcher, now: () => now, ...quick })
    const prices = await book.get('Covens')
    expect(prices.divineChaos).toBe(120)
    expect(prices.chaosByName["Baran's Crest"]).toBe(40)
    expect(requests).toBe(CATEGORY_COUNT)
    now = 30 * 60 * 1000
    await new PriceBook(file, { fetch: fetcher, now: () => now, ...quick }).get('Covens')
    expect(requests).toBe(CATEGORY_COUNT)
    now = 61 * 60 * 1000
    await book.get('Covens')
    expect(requests).toBe(2 * CATEGORY_COUNT)
  })

  it('shares one download between callers that ask at the same time', async () => {
    let requests = 0
    const book = new PriceBook(join(dir, 'prices.json'), { fetch: ninjaFetch(() => requests++), ...quick })
    await Promise.all([book.get('Covens'), book.get('Covens')])
    expect(requests).toBe(CATEGORY_COUNT)
  })

  it('gets by without the extra categories but not without currency', async () => {
    const onlyCurrency = (async (url: URL) =>
      url.searchParams.get('type') === 'Currency' ? respond(ninjaAnswer) : respond({}, 404)) as unknown as typeof fetch
    const prices = await new PriceBook(join(dir, 'a.json'), { fetch: onlyCurrency, ...quick }).get('Covens')
    expect(prices.divineChaos).toBe(120)

    const noCurrency = (async () => respond({}, 500)) as unknown as typeof fetch
    await expect(new PriceBook(join(dir, 'b.json'), { fetch: noCurrency, ...quick }).get('Covens')).rejects.toThrow(/500/)
  })

  it('falls back to stale prices when poe.ninja is down', async () => {
    let now = 0
    let down = false
    const fetcher = (async (url: URL) => (down ? respond({}, 500) : ninjaFetch()(url))) as unknown as typeof fetch
    const book = new PriceBook(join(dir, 'prices.json'), { fetch: fetcher, now: () => now, ...quick })
    await book.get('Covens')
    down = true
    now = 2 * 60 * 60 * 1000
    expect((await book.get('Covens')).divineChaos).toBe(120)
  })

  it('ignores a cache written by an earlier build', async () => {
    const file = join(dir, 'prices.json')
    writeFileSync(file, JSON.stringify({ league: 'Covens', fetchedAt: 0, chaosByName: { 'Scroll of Wisdom': 1 }, divineChaos: 1 }))
    expect(new PriceBook(file, quick).peek('Covens')).toBeNull()
  })
})

describe('SanctumService', () => {
  function setup(
    answers: unknown[],
    options: { encryption?: boolean; characters?: () => unknown; relics?: SanctumDeps['relics'] } = {}
  ) {
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
      prices: new PriceBook(join(dir, 'prices.json'), { fetch: ninjaFetch(), sleep: async () => {} }),
      relics: options.relics,
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
      currency: { 'Divine Orb': 4 }
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

  // ── Readings after every room, tracked currency, counters ──

  it('reads the inventory after a room change, so loot shows before the floor ends', async () => {
    const { service, asked } = setup([siteAnswer([]), siteAnswer([], 0), siteAnswer([stack('Chaos Orb', 4)], 0)])
    await service.saveAccess(access)
    asked.length = 0
    service.onArea(sec(0), 'SanctumFoyer_1_1', 'entrance')
    service.onArea(sec(5), 'SanctumCellar', 'room-0')
    await service.settled()
    service.onArea(sec(20), 'SanctumCellar', 'room-1')
    await service.settled()
    expect(asked).toEqual(['get-items Tester', 'get-items Tester'])
    expect(service.view().active?.run.floors[0].loot).toMatchObject({ chaos: 4 })
  })

  it('skips a room reading when a newer one is already waiting', async () => {
    const { service, asked } = setup([siteAnswer([]), siteAnswer([], 0), siteAnswer([stack('Chaos Orb', 9)], 0)])
    await service.saveAccess(access)
    asked.length = 0
    // Four rooms in a row with no time for the site in between: one baseline, then only the last reading.
    service.onArea(sec(0), 'SanctumFoyer_1_1', 'entrance')
    for (let i = 0; i < 4; i++) service.onArea(sec(5 + i), 'SanctumCellar', `room-${i}`)
    await service.settled()
    expect(asked).toHaveLength(2)
    expect(service.view().active?.run.loot).toMatchObject({ chaos: 9 })
  })

  it('stops room readings near the half-hour limit but still reads at the end of the floor', async () => {
    const answers = [siteAnswer([]), ...Array.from({ length: 80 }, () => siteAnswer([], 0)), siteAnswer([stack('Divine Orb', 1)], 0)]
    const { service, asked } = setup(answers)
    await service.saveAccess(access)
    service.onArea(sec(0), 'SanctumFoyer_1_1', 'entrance')
    // Far more room changes than the allowance; each one waits for the previous reading.
    for (let i = 0; i < 90; i++) {
      service.onArea(sec(5 + i), 'SanctumCellar', `room-${i}`)
      await service.settled()
    }
    const afterRooms = asked.length
    expect(afterRooms).toBe(70)
    service.onArea(sec(200), 'SanctumFoyer_Fellshrine', 'lobby')
    await service.settled()
    expect(asked.length).toBe(afterRooms + 1)
  })

  it('counts runs started in the session and today, including the one in progress', async () => {
    const { service } = setup([])
    playFloor(service, 1, 0)
    service.failActive()
    service.onArea(Date.now(), 'SanctumFoyer_1_1', 'another')
    // The first run is dated in the past (the fixture clock), the second one now.
    expect(service.view().runCounts.session).toBe(2)
    expect(service.view().runCounts.today).toBeGreaterThanOrEqual(1)
    service.newSession()
    expect(service.view().runCounts.session).toBe(0)
  })

  it('keeps the finished run on screen until the player leaves the lobby', async () => {
    const { service } = setup([])
    let t = 0
    for (const floor of [1, 2, 3, 4]) t = playFloor(service, floor, t)
    service.onDialogue(sec(t - 1), 'Lycia, Herald of the Scourge', '*laughter*')
    service.onArea(sec(t), 'SanctumFoyer_Fellshrine', 'lobby')
    expect(service.view()).toMatchObject({ active: null, finished: { outcome: 'completed' } })
    service.onArea(sec(t + 30), 'HideoutSpace', '1')
    expect(service.view().finished).toBeNull()
  })

  it('remembers which currency to track and offers the price source as a catalog', async () => {
    const { service } = setup([])
    expect(service.view().tracked.map((item) => item.name)).toEqual(['Divine Orb', 'Chaos Orb'])
    service.setTracked([' Volatile Vaal Orb ', 'Chaos Orb', 'Chaos Orb', ''], true)
    expect(service.view()).toMatchObject({ trackAll: true })
    expect(service.view().tracked.map((item) => item.name)).toEqual(['Volatile Vaal Orb', 'Chaos Orb'])

    const catalog = await service.getCatalog()
    expect(catalog.map((item) => item.name)).toContain('Volatile Vaal Orb')
    // Once prices are loaded, tracked items get their pictures.
    expect(service.view().tracked[0].icon).toBe('https://web.poecdn.com/gen/image/volatile.png')

    const reopened = setup([]).service.view()
    expect(reopened.tracked.map((item) => item.name)).toEqual(['Volatile Vaal Orb', 'Chaos Orb'])
    expect(reopened.trackAll).toBe(true)
  })

  it('counts every currency picked up, for the statistics of tracked items', async () => {
    const { service } = setup([
      siteAnswer([]),
      siteAnswer([], 0),
      siteAnswer([stack('Volatile Vaal Orb', 3), stack('Chaos Orb', 12), single('relic', 'Urn Relic')], 0)
    ])
    await service.saveAccess(access)
    playFloor(service, 1, 0)
    service.failActive()
    await service.settled()
    const { stats, runs } = service.view()
    expect(stats.session.currency).toEqual({ 'Volatile Vaal Orb': 3, 'Chaos Orb': 12 })
    expect(stats.session.chaos).toBe(1812)
    expect(runs[0].loot.lines.find((line) => line.name === 'Volatile Vaal Orb')).toMatchObject({
      currency: true,
      icon: expect.stringContaining('VolatileVaalOrb')
    })
  })

  // ── Relics ──

  const relicItem = (id: string, mod: string) => ({
    id,
    typeLine: 'Urn Relic of Fortune',
    baseType: 'Urn Relic',
    rarity: 'Magic',
    identified: true,
    explicitMods: [{ description: mod }]
  })

  it('prices a relic that dropped and adds it to the totals when the price arrives', async () => {
    let release: (price: { pricing: 'priced'; chaos: number; note: string; url: string | null }) => void = () => {}
    const asked: string[][] = []
    const relics: SanctumDeps['relics'] = {
      price: (relic) => {
        asked.push(relic.mods)
        return new Promise((resolve) => (release = resolve))
      }
    }
    const { service } = setup(
      [siteAnswer([]), siteAnswer([], 0), siteAnswer([stack('Chaos Orb', 10), relicItem('r1', '2 additional Rooms are revealed on the Sanctum Map')], 0)],
      { relics }
    )
    await service.saveAccess(access)
    playFloor(service, 1, 0)
    service.onArea(sec(100), 'SanctumFoyer_Fellshrine', 'lobby')
    await service.settled()

    // The relic is listed at once, waiting; the currency is already counted.
    const waiting = service.view().active!.run.loot
    expect(asked).toEqual([['2 additional Rooms are revealed on the Sanctum Map']])
    expect(waiting).toMatchObject({ chaos: 10, unpriced: 1 })
    expect(waiting.lines.find((line) => line.relic)?.relic).toMatchObject({ itemId: 'r1', pricing: 'pending' })

    release({ pricing: 'priced', chaos: 1200, note: 'Медиана 5 самых дешёвых из 6 лотов с теми же модами.', url: 'https://www.pathofexile.com/trade/search/Covens/abc' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    const priced = service.view().active!.run
    expect(priced.loot).toMatchObject({ chaos: 1210, divine: 1210 / 120, unpriced: 0 })
    expect(priced.floors[0].loot?.lines[0]).toMatchObject({
      chaos: 1200,
      relic: { pricing: 'priced', note: expect.stringContaining('5'), tradeUrl: 'https://www.pathofexile.com/trade/search/Covens/abc' }
    })
  })

  it('says relics are not priced when no pricer is available', async () => {
    const { service } = setup([siteAnswer([]), siteAnswer([], 0), siteAnswer([relicItem('r1', 'Gain 20 Resolve when you use a Fountain')], 0)])
    await service.saveAccess(access)
    playFloor(service, 1, 0)
    service.failActive()
    await service.settled()
    expect(service.view().runs[0].loot.lines[0].relic).toMatchObject({ pricing: 'none', note: 'Оценка реликвий недоступна.' })
  })
})
