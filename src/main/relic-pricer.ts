import {
  estimatePrice,
  matchRelicMods,
  relicQuery,
  relicSignature,
  type MatchedStat,
  type RelicInfo
} from '@core/sanctum/relics'
import type { RelicLine } from '@shared/sanctum'
import type { PriceBook } from './prices'
import { TradeError, type TradeClient } from './trade'

export interface RelicPrice {
  pricing: Exclude<RelicLine['pricing'], 'pending'>
  chaos: number | null
  note: string
}

const CACHE_MS = 60 * 60 * 1000
/** After the trade site refuses access there is no point in asking again right away. */
const REFUSED_PAUSE_MS = 10 * 60 * 1000
/** With fewer offers than this for the exact modifiers, single modifiers are looked at too. */
const ENOUGH_OFFERS = 3

interface Estimate {
  chaos: number
  offers: number
  basis: string
}

/**
 * Estimates what a Sanctum relic sells for by searching the trade site for relics with the
 * same modifiers. Relics are priced one at a time; identical ones are priced once an hour.
 */
export class RelicPricer {
  private queue: Promise<unknown> = Promise.resolve()
  private readonly cache = new Map<string, { at: number; price: RelicPrice }>()
  private refusedUntil = 0
  private readonly now: () => number

  constructor(
    private readonly trade: TradeClient,
    private readonly prices: PriceBook,
    now: () => number = Date.now
  ) {
    this.now = now
  }

  price(relic: RelicInfo, league: string): Promise<RelicPrice> {
    const result = this.queue.then(() => this.evaluate(relic, league))
    this.queue = result.catch(() => {})
    return result
  }

  private async evaluate(relic: RelicInfo, league: string): Promise<RelicPrice> {
    const { matched, unmatched } = matchRelicMods(relic.mods)
    if (!relic.unique && !matched.length) {
      return { pricing: 'none', chaos: null, note: `Моды не распознаны: ${unmatched.join('; ') || 'их нет'}.` }
    }

    const key = `${league}|${relicSignature(relic, matched)}`
    const cached = this.cache.get(key)
    if (cached && this.now() - cached.at < CACHE_MS) return cached.price
    if (this.now() < this.refusedUntil) {
      return { pricing: 'failed', chaos: null, note: 'Трейд отказал в доступе: проверь cookie в настройках Sanctum.' }
    }

    try {
      const { chaosById } = await this.prices.get(league)
      const lookup = async (stats: MatchedStat[], basis: string): Promise<Estimate | null> => {
        const search = await this.trade.search(league, relicQuery(relic, stats))
        if (!search.offers.length) return null
        const estimate = estimatePrice(await this.trade.fetch(search.id, search.offers), chaosById)
        return estimate && { ...estimate, basis }
      }

      let best = await lookup(matched, relic.unique ? 'этого уника' : 'с теми же модами')
      // A relic is usually worth its best modifier. When too few relics share the whole set,
      // the offers for each modifier alone give a firmer price.
      if (!relic.unique && matched.length > 1 && (best?.offers ?? 0) < ENOUGH_OFFERS) {
        for (const stat of matched) {
          const single = await lookup([stat], `с модом «${stat.text}»`)
          if (single && (!best || single.chaos > best.chaos)) best = single
        }
      }

      const price: RelicPrice = best
        ? { pricing: 'priced', chaos: best.chaos, note: `По ${best.offers} самым дешёвым лотам ${best.basis}.` }
        : { pricing: 'none', chaos: null, note: 'Похожих лотов на трейде нет.' }
      this.cache.set(key, { at: this.now(), price })
      return price
    } catch (error) {
      if (error instanceof TradeError && error.kind === 'forbidden') this.refusedUntil = this.now() + REFUSED_PAUSE_MS
      const reason = error instanceof Error ? error.message : 'Не удалось оценить.'
      return { pricing: 'failed', chaos: null, note: reason }
    }
  }
}
