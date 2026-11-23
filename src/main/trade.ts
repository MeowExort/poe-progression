import type { Listing } from '@core/sanctum/relics'

/** A failed request to the trade site, with a message fit to show to the player. */
export class TradeError extends Error {
  constructor(
    readonly kind: 'forbidden' | 'rate-limit' | 'network' | 'unexpected',
    message: string
  ) {
    super(message)
  }
}

/** Sends one HTTP request. In the app this goes through Electron's own network stack. */
export type TradeRequest = (
  url: string,
  init: { method: 'GET' | 'POST'; headers: Record<string, string>; body?: string }
) => Promise<Response>

export interface TradeOptions {
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

type Endpoint = 'search' | 'fetch'

/** Spacing used until the site's own limits are known from its answers. */
const DEFAULT_INTERVAL_MS: Record<Endpoint, number> = { search: 10_000, fetch: 2_000 }
/** How many offers one fetch may ask for. */
const FETCH_BATCH = 10

/**
 * The official trade site's search, as its own web page uses it: a search returns the ids of
 * matching offers, a fetch returns the offers themselves. Requests are spaced out to stay
 * inside the limits the site announces in its response headers.
 */
export class TradeClient {
  private readonly now: () => number
  private readonly sleep: (ms: number) => Promise<void>
  private readonly interval: Record<Endpoint, number> = { ...DEFAULT_INTERVAL_MS }
  private readonly nextAt: Record<Endpoint, number> = { search: 0, fetch: 0 }
  private blockedUntil = 0

  constructor(
    private readonly request: TradeRequest,
    options: TradeOptions = {}
  ) {
    this.now = options.now ?? Date.now
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  }

  /** Runs a search. Returns the search's id and the ids of the cheapest matching offers. */
  async search(league: string, body: unknown): Promise<{ id: string; offers: string[]; total: number }> {
    const answer = (await this.call(
      'search',
      `https://www.pathofexile.com/api/trade/search/${encodeURIComponent(league)}`,
      JSON.stringify(body)
    )) as { id?: unknown; result?: unknown; total?: unknown }
    if (typeof answer.id !== 'string' || !Array.isArray(answer.result)) {
      throw new TradeError('unexpected', 'Трейд прислал ответ в незнакомом формате.')
    }
    return {
      id: answer.id,
      offers: answer.result.filter((id): id is string => typeof id === 'string'),
      total: typeof answer.total === 'number' ? answer.total : answer.result.length
    }
  }

  /** Reads the prices of up to ten offers of a search. */
  async fetch(searchId: string, offers: string[]): Promise<Listing[]> {
    const ids = offers.slice(0, FETCH_BATCH)
    if (!ids.length) return []
    const answer = (await this.call(
      'fetch',
      `https://www.pathofexile.com/api/trade/fetch/${ids.join(',')}?query=${encodeURIComponent(searchId)}`
    )) as { result?: unknown }
    if (!Array.isArray(answer.result)) throw new TradeError('unexpected', 'Трейд прислал ответ в незнакомом формате.')
    const listings: Listing[] = []
    for (const entry of answer.result as ({ listing?: { price?: { amount?: unknown; currency?: unknown } } } | null)[]) {
      const price = entry?.listing?.price
      if (price && typeof price.amount === 'number' && typeof price.currency === 'string') {
        listings.push({ amount: price.amount, currency: price.currency })
      }
    }
    return listings
  }

  private async call(endpoint: Endpoint, url: string, body?: string): Promise<unknown> {
    const blocked = Math.ceil((this.blockedUntil - this.now()) / 1000)
    if (blocked > 0) throw new TradeError('rate-limit', `Трейд просит подождать ещё ${blocked} с.`)

    const wait = this.nextAt[endpoint] - this.now()
    if (wait > 0) await this.sleep(wait)
    this.nextAt[endpoint] = this.now() + this.interval[endpoint]

    let response: Response
    try {
      response = await this.request(url, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body
      })
    } catch {
      throw new TradeError('network', 'Не удалось связаться с трейдом.')
    }
    this.learnLimits(endpoint, response.headers)

    if (response.status === 429) {
      const seconds = Number.parseInt(response.headers.get('retry-after') ?? '', 10) || 60
      this.blockedUntil = this.now() + seconds * 1000
      throw new TradeError('rate-limit', `Слишком много запросов: трейд просит подождать ${seconds} с.`)
    }

    const answer = await readJson(response)
    if (response.status === 401 || response.status === 403) {
      throw new TradeError('forbidden', 'Трейд отказал в доступе: проверь cookie в настройках Sanctum.')
    }
    if (!response.ok || !answer || answer.error) {
      const reason = typeof answer?.error?.message === 'string' ? answer.error.message : `ошибка ${response.status}`
      throw new TradeError('unexpected', `Трейд не выполнил запрос: ${reason}.`)
    }
    return answer
  }

  /**
   * Reads the limits from the answer, e.g. "x-rate-limit-ip: 5:10:60,15:60:300,30:300:1800"
   * (requests : seconds : penalty), and spaces requests so the strictest one is never hit.
   */
  private learnLimits(endpoint: Endpoint, headers: Headers): void {
    const rules = headers.get('x-rate-limit-rules')
    if (!rules) return
    let slowest = 0
    for (const rule of rules.split(',')) {
      for (const limit of (headers.get(`x-rate-limit-${rule.trim().toLowerCase()}`) ?? '').split(',')) {
        const [max, seconds] = limit.split(':').map(Number)
        if (max > 0 && seconds > 0) slowest = Math.max(slowest, seconds / max)
      }
    }
    // A little slower than the limit allows: the site's clock and ours do not tick together.
    if (slowest > 0) this.interval[endpoint] = Math.ceil(slowest * 1000 * 1.15)
  }
}

/** The body as JSON, or null when it is not JSON at all (an error page, for instance). */
async function readJson(response: Response): Promise<{ error?: { message?: unknown } } | null> {
  try {
    return (await response.json()) as { error?: { message?: unknown } } | null
  } catch {
    return null
  }
}
