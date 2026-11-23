import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { parseCurrencyOverview, type Prices } from '@core/sanctum/prices'

const MAX_AGE_MS = 60 * 60 * 1000
const TIMEOUT_MS = 20000

/** Currency prices from poe.ninja, cached on disk and refreshed at most once an hour. */
export class PriceBook {
  private cached: Prices | null = null

  constructor(
    private readonly file: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = Date.now
  ) {
    try {
      this.cached = JSON.parse(readFileSync(file, 'utf8')) as Prices
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
  async get(league: string): Promise<Prices> {
    const cached = this.peek(league)
    if (cached && this.now() - cached.fetchedAt < MAX_AGE_MS) return cached

    try {
      const url = new URL('https://poe.ninja/poe1/api/economy/stash/current/currency/overview')
      url.searchParams.set('league', league)
      url.searchParams.set('type', 'Currency')
      const response = await this.fetchImpl(url, {
        headers: { 'User-Agent': 'poe-progression/0.1 (personal tool)' },
        signal: AbortSignal.timeout(TIMEOUT_MS)
      })
      if (!response.ok) throw new Error(`poe.ninja ответил ошибкой ${response.status}`)
      const prices = parseCurrencyOverview(await response.json(), league, this.now())
      if (!prices) throw new Error('poe.ninja прислал данные в незнакомом формате')
      this.cached = prices
      mkdirSync(dirname(this.file), { recursive: true })
      writeFileSync(this.file, JSON.stringify(prices))
      return prices
    } catch (error) {
      if (cached) return cached
      throw error instanceof Error ? error : new Error('Не удалось получить цены с poe.ninja')
    }
  }
}
