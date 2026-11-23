import {
  estimatePrice,
  isValuable,
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
  /** The trade search the verdict rests on, for the player to look at. */
  url: string | null
}

const CACHE_MS = 60 * 60 * 1000
/** After the trade site refuses access there is no point in asking again right away. */
const REFUSED_PAUSE_MS = 10 * 60 * 1000
/**
 * How many offers make a market. One or two sellers can ask anything — a junk modifier at a
 * perfect roll listed for hundreds of chaos is not worth that — so fewer offers are not a price.
 */
const ENOUGH_OFFERS = 3
/** When exact rolls are too rare to price, relics with rolls down to this share of them are looked at. */
const RELAXED_SHARE = 0.8

/** What one search on the trade site showed. */
interface Probe {
  url: string
  /** How many offers match in all. */
  total: number
  /** Median of the cheapest few, in Chaos Orbs; null when none has a usable price. */
  chaos: number | null
  /** How many offers that median was taken from. */
  sampled: number
  cheapest: number | null
}

/** A search that found a market, and how it was worded. */
interface Verdict {
  probe: Probe
  /** "с теми же модами", "с модом «…»" */
  basis: string
  /** True when the rolls had to be loosened to find enough offers. */
  relaxed: boolean
  /** True when a known valuable modifier was priced by its cheapest offer, there being too few for a median. */
  thin?: boolean
  /** Offers found for the exact rolls before loosening. */
  exactTotal: number
}

/**
 * Estimates what a Sanctum relic sells for by searching the trade site for relics with the
 * same modifiers. Relics are priced one at a time; identical searches are reused for an hour.
 *
 * The estimate is deliberately cautious. It only counts a price backed by several offers:
 * first for the same modifiers at the same rolls or better, then at slightly lower rolls, then
 * for each modifier on its own (a relic is usually worth its best modifier). When no search
 * finds enough offers the relic gets no price, with what little was found said in the note.
 *
 * The exception is the short list of modifiers the player knows to be valuable: those are
 * priced by the cheapest offer even when only one or two are on sale, and are never loosened.
 */
export class RelicPricer {
  private queue: Promise<unknown> = Promise.resolve()
  private readonly relicCache = new Map<string, { at: number; price: RelicPrice }>()
  private readonly probeCache = new Map<string, { at: number; probe: Probe }>()
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
      return { pricing: 'none', chaos: null, url: null, note: `Моды не распознаны: ${unmatched.join('; ') || 'их нет'}.` }
    }

    const key = `${league}|${relicSignature(relic, matched)}`
    const cached = this.relicCache.get(key)
    if (cached && this.now() - cached.at < CACHE_MS) return cached.price
    if (this.now() < this.refusedUntil) {
      return { pricing: 'failed', chaos: null, url: null, note: 'Трейд отказал в доступе: проверь cookie в настройках Sanctum.' }
    }

    try {
      const price = relic.unique
        ? await this.priceUnique(relic, league)
        : await this.priceByMods(relic, matched, league)
      this.relicCache.set(key, { at: this.now(), price })
      return price
    } catch (error) {
      if (error instanceof TradeError && error.kind === 'forbidden') this.refusedUntil = this.now() + REFUSED_PAUSE_MS
      const reason = error instanceof Error ? error.message : 'Не удалось оценить.'
      return { pricing: 'failed', chaos: null, url: null, note: reason }
    }
  }

  /** Every copy of a unique is the same item, so any offers at all show its price. */
  private async priceUnique(relic: RelicInfo, league: string): Promise<RelicPrice> {
    const probe = await this.probe(relic, [], league)
    if (probe.chaos === null) return { pricing: 'none', chaos: null, url: probe.url, note: 'Этот уник сейчас никто не продаёт.' }
    return {
      pricing: 'priced',
      chaos: probe.chaos,
      url: probe.url,
      note: `Медиана ${probe.sampled} самых дешёвых из ${probe.total} лотов этого уника.`
    }
  }

  private async priceByMods(relic: RelicInfo, matched: MatchedStat[], league: string): Promise<RelicPrice> {
    const whole = await this.market(relic, matched, 'с теми же модами', league)
    let best = whole.verdict
    const thin = [whole.exact]

    if (!best && matched.length > 1) {
      for (const stat of matched) {
        const single = await this.market(relic, [stat], `с модом «${stat.text}»`, league)
        thin.push(single.exact)
        if (single.verdict && (!best || worth(single.verdict) > worth(best))) best = single.verdict
      }
    }

    if (best?.thin) {
      return {
        pricing: 'priced',
        chaos: best.probe.cheapest,
        url: best.probe.url,
        note: `Ценный мод, лотов мало (${best.probe.total}): взят самый дешёвый ${best.basis}.`
      }
    }
    if (best) {
      const { probe, basis, relaxed, exactTotal } = best
      const sample = `медиана ${probe.sampled} самых дешёвых из ${probe.total} лотов ${basis}`
      return {
        pricing: 'priced',
        chaos: probe.chaos,
        url: probe.url,
        note: relaxed
          ? `Таких же по значениям лотов мало (${exactTotal}), поэтому взята ${sample} со значениями от ${RELAXED_SHARE * 100}%.`
          : `${sample[0].toUpperCase()}${sample.slice(1)}.`
      }
    }

    // No market anywhere. Say what was seen, so a rare valuable relic is not mistaken for junk.
    const seen = thin.filter((probe) => probe.total > 0).sort((a, b) => (b.cheapest ?? 0) - (a.cheapest ?? 0))[0]
    return {
      pricing: 'none',
      chaos: null,
      url: (seen ?? whole.exact).url,
      note: seen
        ? `Слишком мало лотов для оценки: ${seen.total}` +
          (seen.cheapest !== null ? `, самый дешёвый — ${Math.round(seen.cheapest)} c` : '') +
          '. В суммы не входит — посмотри на трейде.'
        : 'Похожих лотов на трейде нет.'
    }
  }

  /**
   * Looks for a market for the modifiers: at these rolls or better, and failing that at
   * slightly lower rolls. Returns the exact search in any case, for the note.
   */
  private async market(
    relic: RelicInfo,
    stats: MatchedStat[],
    basis: string,
    league: string
  ): Promise<{ exact: Probe; verdict: Verdict | null }> {
    const exact = await this.probe(relic, stats, league)
    if (isMarket(exact)) return { exact, verdict: { probe: exact, basis, relaxed: false, exactTotal: exact.total } }

    // A modifier known to be valuable, on its own: the few offers there are do show its price.
    if (stats.length === 1 && isValuable(stats[0]) && exact.cheapest !== null) {
      return { exact, verdict: { probe: exact, basis, relaxed: false, exactTotal: exact.total, thin: true } }
    }

    // A valuable roll keeps its value: a little lower and it is a different, cheap relic.
    const loosened = stats.map((stat) => (isValuable(stat) ? stat : { ...stat, value: relax(stat.value) }))
    // Small whole numbers ("2 additional Rooms") cannot be loosened without becoming another tier.
    if (loosened.every((stat, i) => stat.value === stats[i].value)) return { exact, verdict: null }
    const relaxed = await this.probe(relic, loosened, league)
    return {
      exact,
      verdict: isMarket(relaxed) ? { probe: relaxed, basis, relaxed: true, exactTotal: exact.total } : null
    }
  }

  /** One search and, when it found anything, the prices of its cheapest offers. */
  private async probe(relic: RelicInfo, stats: MatchedStat[], league: string): Promise<Probe> {
    const key = `${league}|${relicSignature(relic, stats)}`
    const cached = this.probeCache.get(key)
    if (cached && this.now() - cached.at < CACHE_MS) return cached.probe

    const { chaosById } = await this.prices.get(league)
    const search = await this.trade.search(league, relicQuery(relic, stats))
    const listings = search.offers.length ? await this.trade.fetch(search.id, search.offers) : []
    const estimate = estimatePrice(listings, chaosById)
    const inChaos = listings
      .map((listing) => listing.amount * (chaosById[listing.currency] ?? NaN))
      .filter((price) => Number.isFinite(price) && price > 0)
    const probe: Probe = {
      url: `https://www.pathofexile.com/trade/search/${encodeURIComponent(league)}/${search.id}`,
      total: search.total,
      chaos: estimate?.chaos ?? null,
      sampled: estimate?.offers ?? 0,
      cheapest: inChaos.length ? Math.min(...inChaos) : null
    }
    this.probeCache.set(key, { at: this.now(), probe })
    return probe
  }
}

/** What a verdict says the relic is worth, in Chaos Orbs. */
function worth(verdict: Verdict): number {
  return (verdict.thin ? verdict.probe.cheapest : verdict.probe.chaos) ?? 0
}

function isMarket(probe: Probe): boolean {
  return probe.total >= ENOUGH_OFFERS && probe.sampled >= ENOUGH_OFFERS && probe.chaos !== null
}

/** A slightly lower roll, rounded up so a small whole number stays what it is. */
function relax(value: number | null): number | null {
  return value !== null && value > 0 ? Math.ceil(value * RELAXED_SHARE) : value
}
