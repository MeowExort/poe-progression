import { describe, expect, it } from 'vitest'
import { diffSnapshots, toSnapshot } from '../src/core/sanctum/inventory'
import { combinePrices, valueLoot } from '../src/core/sanctum/prices'
import { estimatePrice, matchRelicMods, relicQuery, relicSignature, type RelicInfo } from '../src/core/sanctum/relics'
import { mergeLoot, retotal } from '../src/core/sanctum/stats'
import { PriceBook } from '../src/main/prices'
import { RelicPricer } from '../src/main/relic-pricer'
import { TradeClient, TradeError, type TradeRequest } from '../src/main/trade'

const REVEAL = 'sanctum.stat_386901949'
const CHEST_AUREUS = 'sanctum.stat_3926246735'
const chaosById = { chaos: 1, divine: 200, exalted: 1 }

const relic = (mods: string[], patch: Partial<RelicInfo> = {}): RelicInfo => ({ baseType: 'Urn Relic', unique: null, mods, ...patch })

describe('matchRelicMods', () => {
  it('recognises modifiers and reads their rolls', () => {
    const { matched, unmatched } = matchRelicMods([
      '2 additional Rooms are revealed on the Sanctum Map',
      'Chests have 5% chance to drop Double Aureus Coins',
      'Gain 20 Resolve when you use a Fountain'
    ])
    expect(unmatched).toEqual([])
    expect(matched.map((stat) => [stat.id, stat.value])).toEqual([
      [REVEAL, 2],
      [CHEST_AUREUS, 5],
      ['sanctum.stat_2607697594', 20]
    ])
  })

  it('takes the fixed value of the singular wording', () => {
    expect(matchRelicMods(['An additional Room is revealed on the Sanctum Map']).matched).toMatchObject([{ id: REVEAL, value: 1 }])
  })

  it('reads a "reduced" roll as negative', () => {
    const [stat] = matchRelicMods(['Monsters impact 5% reduced Resolve']).matched
    expect(stat.value).toBe(-5)
  })

  it('returns lines it does not know as unmatched', () => {
    expect(matchRelicMods(['Something brand new in 3.30'])).toEqual({ matched: [], unmatched: ['Something brand new in 3.30'] })
  })
})

describe('relicQuery', () => {
  it('searches relics with every modifier rolled at least as high, cheapest first', () => {
    const item = relic(['2 additional Rooms are revealed on the Sanctum Map', 'Monsters impact 5% reduced Resolve'])
    const body = relicQuery(item, matchRelicMods(item.mods).matched) as { query: Record<string, any>; sort: unknown }
    expect(body.sort).toEqual({ price: 'asc' })
    expect(body.query.status).toEqual({ option: 'available' })
    expect(body.query.filters.type_filters.filters.category).toEqual({ option: 'sanctum.relic' })
    const [group] = body.query.stats
    expect(group.type).toBe('and')
    expect(group.filters[0]).toEqual({ id: REVEAL, value: { min: 2 } })
    // A negative roll is matched exactly, not "or more".
    expect(group.filters[1].value).toEqual({ min: -5, max: -5 })
  })

  it('searches a unique by name', () => {
    const unique = relic(['The Herald of the Scourge drops an additional Forbidden Tome'], { unique: 'The Night Lamp' })
    const body = relicQuery(unique, []) as { query: Record<string, any> }
    expect(body.query).toMatchObject({ name: 'The Night Lamp', type: 'Urn Relic' })
    expect(body.query.stats[0].filters).toEqual([])
    expect(relicSignature(unique, [])).toBe('unique:The Night Lamp')
  })

  it('gives identical relics one signature regardless of modifier order', () => {
    const a = matchRelicMods(['2 additional Rooms are revealed on the Sanctum Map', 'Chests have 5% chance to drop Double Aureus Coins']).matched
    const b = [...a].reverse()
    expect(relicSignature(relic([]), a)).toBe(relicSignature(relic([]), b))
  })
})

describe('estimatePrice', () => {
  it('takes the median of the five cheapest offers, in chaos', () => {
    const listings = [1, 5, 6, 6, 7, 50, 90].map((amount) => ({ amount, currency: 'divine' }))
    expect(estimatePrice(listings, chaosById)).toEqual({ chaos: 1200, offers: 5 })
  })

  it('mixes currencies and ignores ones it has no rate for', () => {
    const listings = [
      { amount: 300, currency: 'chaos' },
      { amount: 2, currency: 'divine' },
      { amount: 1, currency: 'mirror-shard' }
    ]
    expect(estimatePrice(listings, chaosById)).toEqual({ chaos: 350, offers: 2 })
  })

  it('has no price without usable offers', () => {
    expect(estimatePrice([], chaosById)).toBeNull()
    expect(estimatePrice([{ amount: 1, currency: 'unknown' }], chaosById)).toBeNull()
  })
})

describe('relics in the loot', () => {
  const site = (inventory: Record<string, unknown>[]) => ({
    character: { class: 'Assassin', level: 82, league: 'Covens' },
    inventory: { gold: 0 },
    items: inventory.map((item) => ({ inventoryId: 'MainInventory', ...item }))
  })
  const urn = (id: string, mod: string) => ({
    id,
    typeLine: 'Urn Relic of Fortune',
    baseType: 'Urn Relic',
    rarity: 'Magic',
    identified: true,
    explicitMods: [{ description: mod }]
  })
  const prices = combinePrices([{ chaosByName: { 'Chaos Orb': 1 }, icons: {}, chaosById }], 'Covens', 0)

  it('keeps two relics of one name as separate lines with their modifiers, waiting for a price', () => {
    const before = toSnapshot(site([]), 0)!
    const after = toSnapshot(site([urn('a', '2 additional Rooms are revealed on the Sanctum Map'), urn('b', 'Chests have 5% chance to drop Double Aureus Coins')]), 1)!
    const loot = valueLoot(diffSnapshots(before, after), prices)
    expect(loot.lines).toHaveLength(2)
    expect(loot.lines.map((line) => line.relic)).toMatchObject([
      { itemId: 'a', baseType: 'Urn Relic', unique: null, mods: ['2 additional Rooms are revealed on the Sanctum Map'], pricing: 'pending' },
      { itemId: 'b', mods: ['Chests have 5% chance to drop Double Aureus Coins'], pricing: 'pending' }
    ])
    expect(loot).toMatchObject({ chaos: 0, unpriced: 2 })
  })

  it('does not count a relic again after it was moved to another cell', () => {
    const relicItem = urn('a', '2 additional Rooms are revealed on the Sanctum Map')
    const before = toSnapshot(site([{ ...relicItem, x: 0, y: 0 }]), 0)!
    const after = toSnapshot(site([{ ...relicItem, x: 7, y: 3 }]), 1)!
    expect(diffSnapshots(before, after).lines).toEqual([])
  })

  it('reads modifiers given as plain strings too, and skips unidentified relics', () => {
    const snapshot = toSnapshot(
      site([
        { ...urn('a', ''), explicitMods: ['Gain 20 Resolve when you use a Fountain'] },
        { ...urn('b', 'x'), identified: false }
      ]),
      0
    )!
    expect(snapshot.relics).toEqual({ a: { baseType: 'Urn Relic', unique: null, mods: ['Gain 20 Resolve when you use a Fountain'] } })
  })

  it('adds a relic price into the totals when it arrives', () => {
    const before = toSnapshot(site([]), 0)!
    const after = toSnapshot(site([urn('a', '2 additional Rooms are revealed on the Sanctum Map'), { id: 's', typeLine: 'Chaos Orb', stackSize: 10, maxStackSize: 20, frameType: 5 }]), 1)!
    const loot = mergeLoot(null, valueLoot(diffSnapshots(before, after), prices))
    const line = loot.lines.find((entry) => entry.relic)!
    line.chaos = 1200
    line.relic!.pricing = 'priced'
    expect(retotal(loot, 200)).toMatchObject({ chaos: 1210, divine: 6.05, unpriced: 0 })
    expect(retotal(loot, 200).lines[0].relic?.itemId).toBe('a')
  })
})

// ── The trade site, replaced by canned answers ──

const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers })

type Offer = { amount: number; currency: string }

/**
 * A trade site that answers a search by the modifier filters asked for. `offersFor` gets the
 * filters as "id>=min" strings (or just "id") and returns every matching offer, cheapest first.
 */
function fakeTrade(offersFor: (filters: string[], query: Record<string, any>) => Offer[]) {
  const calls: string[] = []
  const searches = new Map<string, Offer[]>()
  const request: TradeRequest = async (url, init) => {
    if (init.method === 'POST') {
      const { query } = JSON.parse(init.body!) as { query: Record<string, any> }
      const filters = (query.stats[0].filters as { id: string; value?: { min?: number } }[]).map((filter) =>
        filter.value?.min !== undefined ? `${filter.id}>=${filter.value.min}` : filter.id
      )
      calls.push(`search ${query.name ?? filters.join(' + ')}`)
      const id = `q${searches.size}`
      const offers = offersFor(filters, query)
      searches.set(id, offers)
      // Like the real site: the ids of the cheapest hundred, and the count of all.
      return json({ id, result: offers.slice(0, 100).map((_, i) => `${id}-${i}`), total: offers.length })
    }
    const id = new URL(url).searchParams.get('query')!
    calls.push('fetch')
    return json({ result: searches.get(id)!.slice(0, 10).map((price) => ({ id: 'x', listing: { price } })) })
  }
  return { request, calls }
}

const quick = { sleep: async () => {} }
const priceBook = () =>
  new PriceBook('/nonexistent/prices.json', {
    ...quick,
    fetch: (async () =>
      json({
        core: { primary: 'chaos', items: [{ id: 'chaos', name: 'Chaos Orb' }, { id: 'divine', name: 'Divine Orb' }] },
        lines: [{ id: 'divine', primaryValue: 200 }],
        items: [{ id: 'divine', name: 'Divine Orb' }]
      })) as unknown as typeof fetch
  })
const divines = (...amounts: number[]) => amounts.map((amount) => ({ amount, currency: 'divine' }))

describe('TradeClient', () => {
  it('posts the search and reads offers and prices back', async () => {
    const seen: { url: string; method: string; body?: string }[] = []
    const client = new TradeClient(async (url, init) => {
      seen.push({ url, method: init.method, body: init.body })
      return init.method === 'POST'
        ? json({ id: 'abc', result: ['o1', 'o2'], total: 2 })
        : json({ result: [{ listing: { price: { amount: 6, currency: 'divine' } } }, null, { listing: {} }] })
    }, quick)
    const search = await client.search('SSF Covens', { query: {} })
    expect(search).toEqual({ id: 'abc', offers: ['o1', 'o2'], total: 2 })
    expect(await client.fetch(search.id, search.offers)).toEqual([{ amount: 6, currency: 'divine' }])
    expect(seen.map((call) => `${call.method} ${call.url}`)).toEqual([
      'POST https://www.pathofexile.com/api/trade/search/SSF%20Covens',
      'GET https://www.pathofexile.com/api/trade/fetch/o1,o2?query=abc'
    ])
  })

  it('spaces searches by the limits the site announces', async () => {
    let now = 0
    const slept: number[] = []
    const client = new TradeClient(
      async () => json({ id: 'a', result: [], total: 0 }, 200, { 'x-rate-limit-rules': 'Ip', 'x-rate-limit-ip': '5:10:60,30:300:1800' }),
      { now: () => now, sleep: async (ms) => { slept.push(ms); now += ms } }
    )
    await client.search('Covens', {})
    await client.search('Covens', {})
    await client.search('Covens', {})
    // The first gap is the cautious default; after that, 300 s / 30 requests plus a margin.
    expect(slept).toEqual([10_000, 11_500])
  })

  it('explains refusals and stops while told to wait', async () => {
    const refused = new TradeClient(async () => json({ error: { code: 6, message: 'Forbidden' } }, 403), quick)
    await expect(refused.search('Covens', {})).rejects.toMatchObject({ kind: 'forbidden' })

    let now = 0
    let requests = 0
    const limited = new TradeClient(async () => { requests++; return json({}, 429, { 'retry-after': '120' }) }, { now: () => now, sleep: async () => {} })
    await expect(limited.search('Covens', {})).rejects.toMatchObject({ kind: 'rate-limit' })
    now = 60_000
    await expect(limited.search('Covens', {})).rejects.toThrow(/ещё 60 с/)
    expect(requests).toBe(1)

    const broken = new TradeClient(async () => json({ error: { code: 2, message: 'Invalid query' } }, 400), quick)
    await expect(broken.search('Covens', {})).rejects.toThrow(/Invalid query/)
    const offline = new TradeClient(async () => { throw new Error('offline') }, quick)
    await expect(offline.search('Covens', {})).rejects.toBeInstanceOf(TradeError)
  })
})

describe('RelicPricer', () => {
  const chaos = (...amounts: number[]): Offer[] => amounts.map((amount) => ({ amount, currency: 'chaos' }))
  const pricerFor = (offersFor: Parameters<typeof fakeTrade>[0]) => {
    const trade = fakeTrade(offersFor)
    return { trade, pricer: new RelicPricer(new TradeClient(trade.request, quick), priceBook()) }
  }
  const searches = (calls: string[]): string[] => calls.filter((call) => call.startsWith('search'))

  const reveal2 = relic(['2 additional Rooms are revealed on the Sanctum Map'])
  const QUANTITY = 'sanctum.stat_1680962389'

  it('prices a relic from the offers with the same modifier, and links to that search', async () => {
    const { trade, pricer } = pricerFor(() => divines(5, 6, 6, 7, 9, 30))
    expect(await pricer.price(reveal2, 'SSF Covens')).toEqual({
      pricing: 'priced',
      chaos: 1200,
      note: 'Медиана 5 самых дешёвых из 6 лотов с теми же модами.',
      url: 'https://www.pathofexile.com/trade/search/SSF%20Covens/q0'
    })
    expect(trade.calls).toEqual([`search ${REVEAL}>=2`, 'fetch'])
  })

  it('does not take a lone overpriced offer for a price: it looks at slightly lower rolls instead', async () => {
    // A junk modifier at a perfect roll: one seller asks 350 chaos; the same modifier a bit lower goes for 3.
    const junk = relic(['Chests have 10% chance to drop Double Aureus Coins'])
    const { trade, pricer } = pricerFor(([filter]) => (filter === `${CHEST_AUREUS}>=10` ? chaos(350) : chaos(2, 3, 3, 4, 5, 6, 350)))
    const price = await pricer.price(junk, 'Covens')
    expect(price).toMatchObject({ pricing: 'priced', chaos: 3, url: expect.stringContaining('/q1') })
    expect(price.note).toBe('Таких же по значениям лотов мало (1), поэтому взята медиана 5 самых дешёвых из 7 лотов с теми же модами со значениями от 80%.')
    expect(searches(trade.calls)).toEqual([`search ${CHEST_AUREUS}>=10`, `search ${CHEST_AUREUS}>=8`])
  })

  it('gives no price when even similar relics are too few, and says what it saw', async () => {
    const { pricer } = pricerFor(([filter]) => (filter === `${CHEST_AUREUS}>=10` ? chaos(350) : chaos(350, 400)))
    expect(await pricer.price(relic(['Chests have 10% chance to drop Double Aureus Coins']), 'Covens')).toEqual({
      pricing: 'none',
      chaos: null,
      note: 'Слишком мало лотов для оценки: 1, самый дешёвый — 350 c. В суммы не входит — посмотри на трейде.',
      url: 'https://www.pathofexile.com/trade/search/Covens/q0'
    })
  })

  it('does not loosen a small whole number into another tier', async () => {
    // Two offers are not a market, and relics with a lower whole number would say nothing about these.
    const tomes = relic(['The Herald of the Scourge drops 2 additional Forbidden Tomes'])
    const { trade, pricer } = pricerFor(() => divines(6, 7))
    const price = await pricer.price(tomes, 'Covens')
    expect(price).toMatchObject({ pricing: 'none', note: expect.stringContaining('2, самый дешёвый — 1200 c') })
    expect(searches(trade.calls)).toHaveLength(1)
  })

  describe('modifiers the player marked as valuable', () => {
    const MERCHANT = 'sanctum.stat_290775436'

    it.each([
      ['2 additional Rooms are revealed on the Sanctum Map', `${REVEAL}>=2`],
      ['The Merchant has 2 additional Choices', `${MERCHANT}>=2`],
      ['25% increased Quantity of Relics Dropped by Monsters', `${QUANTITY}>=25`]
    ])('prices "%s" by its cheapest offer even when only two are on sale', async (mod, search) => {
      const { trade, pricer } = pricerFor(() => divines(6, 9))
      expect(await pricer.price(relic([mod]), 'Covens')).toEqual({
        pricing: 'priced',
        chaos: 1200,
        note: 'Ценный мод, лотов мало (2): взят самый дешёвый с теми же модами.',
        url: 'https://www.pathofexile.com/trade/search/Covens/q0'
      })
      expect(searches(trade.calls)).toEqual([`search ${search}`])
    })

    it('still uses the median when there is a real market', async () => {
      const { pricer } = pricerFor(() => divines(5, 6, 6, 7, 9))
      expect(await pricer.price(reveal2, 'Covens')).toMatchObject({ chaos: 1200, note: expect.stringContaining('Медиана 5') })
    })

    it('does not extend the trust to a roll below the valuable threshold', async () => {
      const { pricer } = pricerFor(() => chaos(40))
      for (const mod of ['An additional Room is revealed on the Sanctum Map', '23% increased Quantity of Relics Dropped by Monsters']) {
        expect(await pricer.price(relic([mod]), 'Covens')).toMatchObject({ pricing: 'none' })
      }
    })

    it('finds the valuable modifier on a relic with junk next to it, without loosening it', async () => {
      const mixed = relic(['25% increased Quantity of Relics Dropped by Monsters', 'Chests have 10% chance to drop Double Aureus Coins'])
      const { trade, pricer } = pricerFor((filters) =>
        filters.length === 2
          ? []
          : filters[0].startsWith(QUANTITY)
            ? divines(4)
            : chaos(1, 2, 3, 4)
      )
      const price = await pricer.price(mixed, 'Covens')
      expect(price).toMatchObject({
        pricing: 'priced',
        chaos: 800,
        note: 'Ценный мод, лотов мало (1): взят самый дешёвый с модом «25% increased Quantity of Relics Dropped by Monsters».'
      })
      // When the pair is loosened, only the junk roll drops (10 → 8); the quantity stays at 25.
      expect(searches(trade.calls)).toContain(`search ${QUANTITY}>=25 + ${CHEST_AUREUS}>=8`)
      expect(searches(trade.calls).some((call) => call.includes(`${QUANTITY}>=20`))).toBe(false)
    })
  })

  it('keeps the price of a valuable modifier that has a real market at its roll', async () => {
    const quantity = (roll: number) => relic([`${roll}% increased Quantity of Relics Dropped by Monsters`])
    // Rolls of 24 and up sell for divines; lower rolls are worth next to nothing.
    const { pricer } = pricerFor(([filter]) => (Number(filter.split('>=')[1]) >= 24 ? divines(2, 3, 3, 4) : chaos(1, 1, 2, 2, 3, ...Array(4).fill(600))))
    expect(matchRelicMods(quantity(25).mods).matched[0].id).toBe(QUANTITY)
    expect(await pricer.price(quantity(25), 'Covens')).toMatchObject({ pricing: 'priced', chaos: 600 })
    expect(await pricer.price(quantity(10), 'Covens')).toMatchObject({ pricing: 'priced', chaos: 2 })
  })

  it('values a relic by its best modifier when the exact combination is rare', async () => {
    const two = relic(['2 additional Rooms are revealed on the Sanctum Map', 'Chests have 5% chance to drop Double Aureus Coins'])
    const { trade, pricer } = pricerFor((filters) =>
      filters.length === 2 ? divines(20) : filters[0].startsWith(REVEAL) ? divines(5, 6, 7) : chaos(1, 2, 3, 4)
    )
    expect(await pricer.price(two, 'Covens')).toEqual({
      pricing: 'priced',
      chaos: 1200,
      note: 'Медиана 3 самых дешёвых из 3 лотов с модом «2 additional Rooms are revealed on the Sanctum Map».',
      url: 'https://www.pathofexile.com/trade/search/Covens/q2'
    })
    // The pair at these rolls, the pair a little lower, then each modifier alone.
    expect(searches(trade.calls)).toHaveLength(4)
  })

  it('asks once for identical relics and reuses a search shared by different relics', async () => {
    const { trade, pricer } = pricerFor(() => divines(6, 6, 6))
    await pricer.price(reveal2, 'Covens')
    await pricer.price({ ...reveal2, baseType: 'Papyrus Relic' }, 'Covens')
    expect(searches(trade.calls)).toHaveLength(1)
  })

  it('prices a unique by name from whatever offers there are', async () => {
    const { pricer } = pricerFor((_filters, query) => (query.name === 'The Night Lamp' ? divines(1, 2) : []))
    const lamp = relic(['The Herald of the Scourge drops an additional Forbidden Tome'], { unique: 'The Night Lamp' })
    expect(await pricer.price(lamp, 'Covens')).toMatchObject({
      pricing: 'priced',
      chaos: 300,
      note: 'Медиана 2 самых дешёвых из 2 лотов этого уника.'
    })
  })

  it('says so when nothing comparable is on sale or the modifiers are unknown', async () => {
    const { pricer } = pricerFor(() => [])
    expect(await pricer.price(reveal2, 'Covens')).toMatchObject({ pricing: 'none', note: 'Похожих лотов на трейде нет.' })
    expect(await pricer.price(relic(['A modifier from the future']), 'Covens')).toMatchObject({
      pricing: 'none',
      url: null,
      note: expect.stringContaining('A modifier from the future')
    })
  })

  it('reports a refusal and does not keep asking', async () => {
    let requests = 0
    const refusing: TradeRequest = async () => { requests++; return json({ error: { message: 'Forbidden' } }, 403) }
    const pricer = new RelicPricer(new TradeClient(refusing, quick), priceBook())
    expect(await pricer.price(reveal2, 'Covens')).toMatchObject({ pricing: 'failed', note: expect.stringContaining('cookie') })
    expect(await pricer.price(relic(['Gain 20 Resolve when you use a Fountain']), 'Covens')).toMatchObject({ pricing: 'failed' })
    expect(requests).toBe(1)
  })
})
