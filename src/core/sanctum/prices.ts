import type { LootLine, LootValue } from '@shared/sanctum'
import type { RawLoot } from './inventory'

export interface Prices {
  /** Format of this structure; raised when prices from an older build must not be reused. */
  version: 3
  league: string
  fetchedAt: number
  /** Item name → price of one in Chaos Orbs. */
  chaosByName: Record<string, number>
  divineChaos: number | null
  /** Item name → picture, for every item the price source lists. */
  icons: Record<string, string>
  /** The trade site's short currency code ("divine", "exalted") → price of one in Chaos Orbs. */
  chaosById: Record<string, number>
}

const ICON_HOST = 'https://web.poecdn.com'

export type PricesPart = Pick<Prices, 'chaosByName' | 'icons' | 'chaosById'>

/**
 * Reads one category of poe.ninja's exchange overview: prices taken from the in-game currency
 * exchange, in Chaos Orbs, with fractions for items cheaper than one. Returns null when the
 * answer has another shape or is not priced in Chaos Orbs.
 */
export function parseExchangeOverview(
  body: unknown
): PricesPart | null {
  const { core, lines, items } = (body ?? {}) as {
    core?: { primary?: unknown; items?: unknown }
    lines?: unknown
    items?: unknown
  }
  if (!Array.isArray(lines) || !Array.isArray(items) || core?.primary !== 'chaos') return null

  const chaosByName: Record<string, number> = {}
  const icons: Record<string, string> = {}
  const nameById = new Map<string, string>()
  type Item = { id?: unknown; name?: unknown; image?: unknown }
  for (const item of [...(items as Item[]), ...(Array.isArray(core.items) ? (core.items as Item[]) : [])]) {
    if (typeof item?.id !== 'string' || typeof item.name !== 'string') continue
    nameById.set(item.id, item.name)
    if (typeof item.image === 'string' && item.image) {
      icons[item.name] = item.image.startsWith('http') ? item.image : ICON_HOST + item.image
    }
  }
  const chaosById: Record<string, number> = {}
  for (const line of lines as { id?: unknown; primaryValue?: unknown }[]) {
    const name = typeof line?.id === 'string' ? nameById.get(line.id) : undefined
    if (name && typeof line.primaryValue === 'number' && line.primaryValue > 0) {
      chaosByName[name] = line.primaryValue
      chaosById[line.id as string] = line.primaryValue
    }
  }
  // Chaos is the unit everything is priced in.
  if (nameById.has('chaos')) {
    chaosByName['Chaos Orb'] = 1
    chaosById.chaos = 1
  }
  return { chaosByName, icons, chaosById }
}

/** Joins the categories into one price list. */
export function combinePrices(parts: PricesPart[], league: string, fetchedAt: number): Prices {
  const chaosByName = Object.assign({}, ...parts.map((part) => part.chaosByName)) as Record<string, number>
  const icons = Object.assign({}, ...parts.map((part) => part.icons)) as Record<string, string>
  const chaosById = Object.assign({}, ...parts.map((part) => part.chaosById)) as Record<string, number>
  return { version: 3, league, fetchedAt, chaosByName, divineChaos: chaosByName['Divine Orb'] ?? null, icons, chaosById }
}

/** Prices the loot. Without prices, or for items without one, lines stay unpriced and out of the sums. */
export function valueLoot(loot: RawLoot, prices: Prices | null): LootValue {
  let chaos = 0
  let unpriced = 0
  const lines = loot.lines
    .map(({ relic, ...line }): LootLine => {
      const icon = line.icon ?? prices?.icons[line.name] ?? null
      if (relic) {
        // A relic is not sold on the currency exchange: its price comes later, from the trade site.
        unpriced++
        return { ...line, icon, chaos: null, relic: { ...relic, pricing: 'pending', note: null } }
      }
      const each = prices?.chaosByName[line.name]
      if (each === undefined) {
        unpriced++
        return { ...line, icon, chaos: null }
      }
      chaos += each * line.count
      return { ...line, icon, chaos: each * line.count }
    })
    // Most valuable first; unpriced items after the priced ones, by name.
    .sort((a, b) => (b.chaos ?? -1) - (a.chaos ?? -1) || a.name.localeCompare(b.name))
  return {
    lines,
    gold: loot.gold,
    chaos,
    divine: prices?.divineChaos ? chaos / prices.divineChaos : null,
    unpriced
  }
}
