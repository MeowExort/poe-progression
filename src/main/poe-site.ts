/** A failed request to pathofexile.com, with a message fit to show to the player. */
export class SiteError extends Error {
  constructor(
    readonly kind: 'auth' | 'not-found' | 'rate-limit' | 'network' | 'unexpected',
    message: string
  ) {
    super(message)
  }
}

export interface SiteOptions {
  fetch?: typeof fetch
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

/** The site allows 30 item requests a minute per account; staying far below costs nothing here. */
const MIN_GAP_MS = 2500
const TIMEOUT_MS = 20000

/**
 * Reads a character's items from pathofexile.com the way the site's own profile page does.
 * The inventory is only included for the account's owner, hence the session cookie.
 * The cookie is sent to www.pathofexile.com and nowhere else.
 */
export class PoeSite {
  private readonly fetch: typeof fetch
  private readonly now: () => number
  private readonly sleep: (ms: number) => Promise<void>
  private lastRequestAt = 0
  private blockedUntil = 0

  constructor(options: SiteOptions = {}) {
    this.fetch = options.fetch ?? fetch
    this.now = options.now ?? Date.now
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  }

  /** A character's equipment, inventory and gold. */
  getItems(account: string, character: string, cookie: string): Promise<unknown> {
    return this.get('get-items', { accountName: account, character, realm: 'pc' }, cookie)
  }

  /** Every character of the account, each with the time it last logged in. */
  getCharacters(account: string, cookie: string): Promise<unknown> {
    return this.get('get-characters', { accountName: account, realm: 'pc' }, cookie)
  }

  private async get(endpoint: string, params: Record<string, string>, cookie: string): Promise<unknown> {
    const wait = Math.ceil((this.blockedUntil - this.now()) / 1000)
    if (wait > 0) throw new SiteError('rate-limit', `Сайт просит подождать с запросами ещё ${wait} с.`)

    const gap = this.lastRequestAt + MIN_GAP_MS - this.now()
    if (gap > 0) await this.sleep(gap)
    this.lastRequestAt = this.now()

    const url = new URL(`https://www.pathofexile.com/character-window/${endpoint}`)
    for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value)

    let response: Response
    try {
      response = await this.fetch(url, {
        headers: { Cookie: `POESESSID=${cookie}`, 'User-Agent': 'poe-progression/0.1 (personal tool)' },
        signal: AbortSignal.timeout(TIMEOUT_MS)
      })
    } catch {
      throw new SiteError('network', 'Не удалось связаться с pathofexile.com.')
    }

    if (response.status === 429) {
      const seconds = Number.parseInt(response.headers.get('retry-after') ?? '', 10) || 60
      this.blockedUntil = this.now() + seconds * 1000
      throw new SiteError('rate-limit', `Слишком много запросов: сайт просит подождать ${seconds} с.`)
    }
    if (response.status === 401 || response.status === 403) {
      throw new SiteError('auth', 'Сайт отказал в доступе: cookie устарела или профиль закрыт. Вставь свежую cookie.')
    }
    if (response.status === 404) {
      throw new SiteError('not-found', 'Сайт не нашёл такого персонажа: проверь имя аккаунта (с #цифрами) и персонажа.')
    }
    if (!response.ok) throw new SiteError('unexpected', `Сайт ответил ошибкой ${response.status}.`)

    try {
      return (await response.json()) as unknown
    } catch {
      throw new SiteError('unexpected', 'Сайт прислал ответ, который не удалось прочитать.')
    }
  }
}

/** Accepts the cookie as copied from the browser, with or without the "POESESSID=" part. */
export function normalizeCookie(input: string): string | null {
  const value = input.trim().replace(/^POESESSID=/i, '').replace(/;.*$/, '').trim()
  return /^[0-9a-f]{32}$/i.test(value) ? value.toLowerCase() : null
}
