import valuableJson from '@data/valuable-relic-mods.json'
import statsJson from '@data/vendor/apt/sanctum-stats.json'

/**
 * What is needed to look an item up on the trade site: a Sanctum relic, or a unique item of
 * any kind picked up along the way.
 */
export interface RelicInfo {
  /** "Urn Relic", "Cloth Belt": relics of different base types are different goods. */
  baseType: string
  /** The unique's name, or null for magic and rare relics. */
  unique: string | null
  mods: string[]
}

/** True for a Sanctum relic, as opposed to a unique piece of gear. */
export const isRelic = (item: Pick<RelicInfo, 'baseType'>): boolean => item.baseType.endsWith(' Relic')

export interface MatchedStat {
  /** The trade site's id of the modifier. */
  id: string
  ref: string
  /** The modifier as written on the item. */
  text: string
  /** The rolled number, negative for "reduced"; null when the modifier has none. */
  value: number | null
}

/** One offer found on the trade site. `currency` is the site's short code: "chaos", "divine"… */
export interface Listing {
  amount: number
  currency: string
}

interface StatData {
  id: string
  ref: string
  better: number
  matchers: { string: string; value?: number; negate?: boolean }[]
}

const NUMBER = '([+-]?\\d+(?:\\.\\d+)?)'
const MATCHERS = (statsJson as StatData[]).flatMap((stat) =>
  stat.matchers.map((matcher) => ({
    stat,
    matcher,
    // "Gain # Resolve when you use a Fountain" → a pattern with the number captured.
    pattern: new RegExp(`^${matcher.string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/#/g, NUMBER)}$`)
  }))
)

/** Recognises a relic's modifier lines. Lines the trade site has no id for come back as unmatched. */
export function matchRelicMods(mods: string[]): { matched: MatchedStat[]; unmatched: string[] } {
  const matched: MatchedStat[] = []
  const unmatched: string[] = []
  for (const mod of mods) {
    const text = mod.trim()
    let found = false
    for (const { stat, matcher, pattern } of MATCHERS) {
      const match = pattern.exec(text)
      if (!match) continue
      const rolled = match[1] !== undefined ? Number(match[1]) : (matcher.value ?? null)
      matched.push({ id: stat.id, ref: stat.ref, text, value: rolled === null ? null : matcher.negate ? -rolled : rolled })
      found = true
      break
    }
    if (!found) unmatched.push(text)
  }
  return { matched, unmatched }
}

/**
 * The search to send to the trade site: relics of the same base type with these modifiers
 * rolled at least as well, cheapest first. A unique is searched by name instead — its
 * modifiers are always the same.
 */
export function relicQuery(relic: RelicInfo, stats: MatchedStat[]): Record<string, unknown> {
  const query: Record<string, unknown> = {
    // Offers that can be bought right now: instant buyout or a seller who is online.
    status: { option: 'available' },
    stats: [
      {
        type: 'and',
        filters: relic.unique
          ? []
          : stats.map((stat) => ({
              id: stat.id,
              // A positive roll: that much or more. A "reduced" roll is stored negative and its
              // better direction differs from modifier to modifier, so it is matched exactly.
              ...(stat.value === null
                ? {}
                : { value: stat.value >= 0 ? { min: stat.value } : { min: stat.value, max: stat.value } })
            }))
      }
    ],
    // The base type is part of what a relic is: a small "Urn Relic" and a large "Coffer Relic"
    // with the same modifier do not cost the same.
    type: relic.baseType
  }
  if (isRelic(relic)) query.filters = { type_filters: { filters: { category: { option: 'sanctum.relic' } } } }
  if (relic.unique) query.name = relic.unique
  return { query, sort: { price: 'asc' } }
}

/** Identical relics cost the same: this is what a price is cached under. */
export function relicSignature(relic: RelicInfo, stats: MatchedStat[]): string {
  if (relic.unique) return `unique:${relic.unique}|${relic.baseType}`
  return `${relic.baseType}|${stats
    .map((stat) => `${stat.id}=${stat.value ?? ''}`)
    .sort()
    .join('&')}`
}

/** How many of the cheapest offers the estimate is taken from. */
const SAMPLE = 5

/**
 * A price from the cheapest offers, in Chaos Orbs: the median of up to five. The very cheapest
 * offer is often bait or a mistake, and the median is not moved by it. Offers priced in a
 * currency without a known rate are left out. Returns null when nothing usable is left.
 */
export function estimatePrice(
  listings: Listing[],
  chaosById: Record<string, number>
): { chaos: number; offers: number } | null {
  const prices = listings
    .map((listing) => listing.amount * (chaosById[listing.currency] ?? NaN))
    .filter((price) => Number.isFinite(price) && price > 0)
    .sort((a, b) => a - b)
    .slice(0, SAMPLE)
  if (!prices.length) return null
  const middle = Math.floor(prices.length / 2)
  const median = prices.length % 2 ? prices[middle] : (prices[middle - 1] + prices[middle]) / 2
  return { chaos: median, offers: prices.length }
}

const VALUABLE = new Map((valuableJson as { id: string; min: number }[]).map((entry) => [entry.id, entry.min]))

/**
 * True for a modifier the player has marked as always worth money at this roll (see
 * data/valuable-relic-mods.json). Such a relic is priced even when only one or two are on
 * sale, where an unknown modifier would be left without a price.
 */
export function isValuable(stat: MatchedStat): boolean {
  const min = VALUABLE.get(stat.id)
  return min !== undefined && stat.value !== null && stat.value >= min
}
