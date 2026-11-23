import type { LootValue } from '@shared/sanctum'
import type { RawLoot } from './inventory'

export interface Prices {
  /** Format of this structure; raised when prices from an older build must not be reused. */
  version: 2
  league: string
  fetchedAt: number
  /** Item name → price of one in Chaos Orbs. */
  chaosByName: Record<string, number>
  divineChaos: number | null
  /** Item name → picture, for every item the price source lists. */
  icons: Record<string, string>
}

const ICON_HOST = 'https://web.poecdn.com'

/**
 * Reads one category of poe.ninja's exchange overview: prices taken from the in-game currency
 * exchange, in Chaos Orbs, with fractions for items cheaper than one. Returns null when the
 * answer has another shape or is not priced in Chaos Orbs.
 */
export function parseExchangeOverview(
  body: unknown
): Pick<Prices, 'chaosByName' | 'icons'> | null {
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
  for (const line of lines as { id?: unknown; primaryValue?: unknown }[]) {
    const name = typeof line?.id === 'string' ? nameById.get(line.id) : undefined
    if (name && typeof line.primaryValue === 'number' && line.primaryValue > 0) chaosByName[name] = line.primaryValue
  }
  // Chaos is the unit everything is priced in.
  if (nameById.has('chaos')) chaosByName['Chaos Orb'] = 1
  return { chaosByName, icons }
}

/** Joins the categories into one price list. */
export function combinePrices(
  parts: Pick<Prices, 'chaosByName' | 'icons'>[],
  league: string,
  fetchedAt: number
): Prices {
  const chaosByName = Object.assign({}, ...parts.map((part) => part.chaosByName)) as Record<string, number>
  const icons = Object.assign({}, ...parts.map((part) => part.icons)) as Record<string, string>
  return { version: 2, league, fetchedAt, chaosByName, divineChaos: chaosByName['Divine Orb'] ?? null, icons }
}

/** Prices the loot. Without prices, or for items without one, lines stay unpriced and out of the sums. */
export function valueLoot(loot: RawLoot, prices: Prices | null): LootValue {
  let chaos = 0
  let unpriced = 0
  const lines = loot.lines
    .map((line) => {
      const icon = line.icon ?? prices?.icons[line.name] ?? null
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
