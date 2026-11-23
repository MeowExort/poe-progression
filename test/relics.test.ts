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

/** A trade site that answers searches by which stat ids are asked for. */
function fakeTrade(offersFor: (statIds: string[], query: Record<string, any>) => { amount: number; currency: string }[]) {
  const calls: string[] = []
  const searches = new Map<string, { amount: number; currency: string }[]>()
  const request: TradeRequest = async (url, init) => {
    if (init.method === 'POST') {
      const { query } = JSON.parse(init.body!) as { query: Record<string, any> }
      const ids = (query.stats[0].filters as { id: string }[]).map((filter) => filter.id)
      calls.push(`search ${query.name ?? ids.join('+')}`)
      const id = `q${searches.size}`
      const offers = offersFor(ids, query)
      searches.set(id, offers)
      return json({ id, result: offers.map((_, i) => `${id}-${i}`), total: offers.length })
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
  const reveal2 = relic(['2 additional Rooms are revealed on the Sanctum Map'])

  it('prices a relic from offers with the same modifier', async () => {
    const trade = fakeTrade(() => divines(5, 6, 6, 7, 9, 30))
    const pricer = new RelicPricer(new TradeClient(trade.request, quick), priceBook())
    expect(await pricer.price(reveal2, 'Covens')).toEqual({
      pricing: 'priced',
      chaos: 1200,
      note: 'По 5 самым дешёвым лотам с теми же модами.'
    })
    expect(trade.calls).toEqual([`search ${REVEAL}`, 'fetch'])
  })

  it('asks once for identical relics', async () => {
    const trade = fakeTrade(() => divines(6, 6, 6))
    const pricer = new RelicPricer(new TradeClient(trade.request, quick), priceBook())
    await pricer.price(reveal2, 'Covens')
    await pricer.price({ ...reveal2, baseType: 'Urn Relic' }, 'Covens')
    expect(trade.calls.filter((call) => call.startsWith('search'))).toHaveLength(1)
  })

  it('falls back to the best single modifier when the exact set is rare', async () => {
    const two = relic(['2 additional Rooms are revealed on the Sanctum Map', 'Chests have 5% chance to drop Double Aureus Coins'])
    const trade = fakeTrade((ids) => (ids.length === 2 ? divines(20) : ids[0] === REVEAL ? divines(5, 6, 7) : [{ amount: 3, currency: 'chaos' }]))
    const pricer = new RelicPricer(new TradeClient(trade.request, quick), priceBook())
    const price = await pricer.price(two, 'Covens')
    // One offer for the pair at 20 divines is not trusted over nothing; it is still the highest here.
    expect(price).toMatchObject({ pricing: 'priced', chaos: 4000 })
    expect(trade.calls.filter((call) => call.startsWith('search'))).toHaveLength(3)
  })

  it('uses the single-modifier price when the exact set has no offers at all', async () => {
    const two = relic(['2 additional Rooms are revealed on the Sanctum Map', 'Chests have 5% chance to drop Double Aureus Coins'])
    const trade = fakeTrade((ids) => (ids.length === 2 ? [] : ids[0] === REVEAL ? divines(5, 6, 7) : []))
    const pricer = new RelicPricer(new TradeClient(trade.request, quick), priceBook())
    expect(await pricer.price(two, 'Covens')).toEqual({
      pricing: 'priced',
      chaos: 1200,
      note: 'По 3 самым дешёвым лотам с модом «2 additional Rooms are revealed on the Sanctum Map».'
    })
  })

  it('searches a unique by name', async () => {
    const trade = fakeTrade((_ids, query) => (query.name === 'The Night Lamp' ? divines(1, 1, 2) : []))
    const pricer = new RelicPricer(new TradeClient(trade.request, quick), priceBook())
    const lamp = relic(['The Herald of the Scourge drops an additional Forbidden Tome'], { unique: 'The Night Lamp' })
    expect(await pricer.price(lamp, 'Covens')).toMatchObject({ pricing: 'priced', chaos: 200, note: expect.stringContaining('этого уника') })
  })

  it('says so when nothing comparable is on sale or the modifiers are unknown', async () => {
    const pricer = new RelicPricer(new TradeClient(fakeTrade(() => []).request, quick), priceBook())
    expect(await pricer.price(reveal2, 'Covens')).toMatchObject({ pricing: 'none', note: 'Похожих лотов на трейде нет.' })
    expect(await pricer.price(relic(['A modifier from the future']), 'Covens')).toMatchObject({
      pricing: 'none',
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
