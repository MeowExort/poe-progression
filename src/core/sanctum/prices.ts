import type { LootValue } from '@shared/sanctum'
import type { RawLoot } from './inventory'

export interface Prices {
  league: string
  fetchedAt: number
  /** Item name → price of one in Chaos Orbs. */
  chaosByName: Record<string, number>
  divineChaos: number | null
}

/** Reads poe.ninja's currency overview: every line is a currency with its price in Chaos Orbs. */
export function parseCurrencyOverview(body: unknown, league: string, fetchedAt: number): Prices | null {
  const lines = (body as { lines?: unknown } | null)?.lines
  if (!Array.isArray(lines)) return null
  // Chaos is the unit everything else is priced in, so the overview does not list it.
  const chaosByName: Record<string, number> = { 'Chaos Orb': 1 }
  for (const line of lines as { currencyTypeName?: unknown; chaosEquivalent?: unknown; pay?: { value?: unknown } | null }[]) {
    if (typeof line?.currencyTypeName !== 'string' || typeof line.chaosEquivalent !== 'number') continue
    let price: number | null = line.chaosEquivalent
    if (price <= 1) {
      // Listings cannot say "less than one Chaos Orb per item", so every cheap currency shows as
      // exactly 1. The opposite direction — how many of it buy one Chaos Orb — gives the real
      // price; without it the price is unknown rather than 1.
      const perChaos = line.pay?.value
      price = typeof perChaos === 'number' && perChaos > 1 ? 1 / perChaos : null
    }
    if (price !== null && price > 0) chaosByName[line.currencyTypeName] = price
  }
  return { league, fetchedAt, chaosByName, divineChaos: chaosByName['Divine Orb'] ?? null }
}

/** Prices the loot. Without prices, or for items without one, lines stay unpriced and out of the sums. */
export function valueLoot(loot: RawLoot, prices: Prices | null): LootValue {
  let chaos = 0
  let unpriced = 0
  const lines = loot.lines
    .map((line) => {
      const each = prices?.chaosByName[line.name]
      if (each === undefined) {
        unpriced++
        return { ...line, chaos: null }
      }
      chaos += each * line.count
      return { ...line, chaos: each * line.count }
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
