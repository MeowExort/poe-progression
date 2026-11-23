import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { combinePrices, parseExchangeOverview, type Prices } from '@core/sanctum/prices'

const MAX_AGE_MS = 60 * 60 * 1000
const TIMEOUT_MS = 20000
/** Pause between category requests, to go easy on poe.ninja. */
const GAP_MS = 300

/** Categories of poe.ninja's exchange overview. The first is required, the rest are welcome. */
const CATEGORIES = [
  'Currency',
  'Fragment',
  'Essence',
  'DivinationCard',
  'Oil',
  'Fossil',
  'Resonator',
  'Tattoo',
  'Omen',
  'DeliriumOrb',
  'Artifact',
  'Runegraft',
  'Thread',
  'AllflameEmber',
  'Astrolabe'
]

export interface PriceBookOptions {
  fetch?: typeof fetch
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

/** Prices from poe.ninja (in-game currency exchange), cached on disk and refreshed at most once an hour. */
export class PriceBook {
  private cached: Prices | null = null
  private loading: Promise<Prices> | null = null
  private readonly fetchImpl: typeof fetch
  private readonly now: () => number
  private readonly sleep: (ms: number) => Promise<void>

  constructor(
    private readonly file: string,
    options: PriceBookOptions = {}
  ) {
    this.fetchImpl = options.fetch ?? fetch
    this.now = options.now ?? Date.now
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
    try {
      const stored = JSON.parse(readFileSync(file, 'utf8')) as Prices
      // Prices saved by an earlier build came from another source and are not comparable.
      if (stored?.version === 2) this.cached = stored
    } catch {
      this.cached = null
    }
  }

  /** The cached prices for the league, however old; null if there are none. */
  peek(league: string): Prices | null {
    return this.cached?.league === league ? this.cached : null
  }

  /**
   * Fresh prices for the league. Falls back to stale ones when poe.ninja cannot be reached;
   * throws only when there is nothing to fall back to.
   */
  get(league: string): Promise<Prices> {
    const cached = this.peek(league)
    if (cached && this.now() - cached.fetchedAt < MAX_AGE_MS) return Promise.resolve(cached)
    // Several callers at once share one download.
    this.loading ??= this.download(league)
      .catch((error: unknown) => {
        if (cached) return cached
        throw error instanceof Error ? error : new Error('Не удалось получить цены с poe.ninja')
      })
      .finally(() => {
        this.loading = null
      })
    return this.loading
  }

  private async download(league: string): Promise<Prices> {
    const parts = []
    for (const [index, category] of CATEGORIES.entries()) {
      if (index > 0) await this.sleep(GAP_MS)
      try {
        parts.push(await this.category(league, category))
      } catch (error) {
        // Without currency there is nothing to value loot with; any other category is a bonus.
        if (index === 0) throw error
      }
    }
    const prices = combinePrices(parts, league, this.now())
    this.cached = prices
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      writeFileSync(this.file, JSON.stringify(prices))
    } catch {
      // The cache only saves a download next time.
    }
    return prices
  }

  private async category(league: string, category: string) {
    const url = new URL('https://poe.ninja/poe1/api/economy/exchange/current/overview')
    url.searchParams.set('league', league)
    url.searchParams.set('type', category)
    const response = await this.fetchImpl(url, {
      headers: { 'User-Agent': 'poe-progression/0.1 (personal tool)' },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
    if (!response.ok) throw new Error(`poe.ninja ответил ошибкой ${response.status}`)
    const parsed = parseExchangeOverview(await response.json())
    if (!parsed) throw new Error('poe.ninja прислал данные в незнакомом формате')
    return parsed
  }
}
