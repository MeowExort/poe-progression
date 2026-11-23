import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { diffSnapshots, entryCount, lastPlayedCharacter, toSnapshot, type InventorySnapshot } from '@core/sanctum/inventory'
import { valueLoot } from '@core/sanctum/prices'
import { classifyArea, SanctumTracker, type Boundary, type TrackedRun } from '@core/sanctum/runs'
import { computeTotals, EMPTY_LOOT, mergeLoot, retotal } from '@core/sanctum/stats'
import type { LootValue, RunView, SanctumAccess, SanctumView, TrackedItem } from '@shared/sanctum'
import { normalizeCookie, SiteError, type PoeSite } from './poe-site'
import type { PriceBook } from './prices'
import type { RelicPricer } from './relic-pricer'
import type { SecretStore } from './secrets'

const COOKIE = 'poesessid'
const SNAPSHOTS_KEPT = 20
const RUNS_SHOWN = 100
/** The site learns about the inventory when the character changes area; give it a moment to catch up. */
const BOUNDARY_DELAY_MS = 3000
const HALF_HOUR_MS = 30 * 60 * 1000
/**
 * The site allows 100 item requests in half an hour and blocks for ten minutes beyond that.
 * Readings after ordinary room changes stop at this many, leaving room for the ones that matter.
 */
const OPTIONAL_BUDGET = 70
const DEFAULT_TRACKED = ['Divine Orb', 'Chaos Orb']
/** Used for the catalog of currency before any character has been read. */
const FALLBACK_LEAGUE = 'Standard'

/** A run as kept on disk: what the tracker saw, plus the loot counted for each floor. */
interface StoredRun extends TrackedRun {
  sessionId: number
  /** Keyed by floor number. */
  loot: Record<number, LootValue>
  lootNote: string | null
}

export interface SanctumDeps {
  /** Where the account and character names are kept (they are not secret). */
  file: string | null
  /** Where the history of runs is kept. */
  runsFile?: string | null
  /** Where raw site answers are saved on request, for working out what the site exposes. */
  debugDir?: string | null
  sleep?: (ms: number) => Promise<void>
  site: PoeSite
  secrets: SecretStore
  prices: PriceBook
  /** Prices relics on the trade site; without it relics stay unpriced. */
  relics?: Pick<RelicPricer, 'price'> | null
  onChange?: (view: SanctumView) => void
  now?: () => number
}

/** Loot tracking: access to the character's inventory, snapshots of it and what was gained between them. */
export class SanctumService {
  private account = ''
  private character = ''
  private autoCharacter = true
  /** The run for which the current character was last looked up. */
  private characterCheckedFor: number | null = null
  private status: SanctumView['status'] = null
  private busy = false
  private snapshots: InventorySnapshot[] = []
  private lastLoot: LootValue | null = null
  private league: string | null = null
  private pricesError: string | null = null
  private readonly now: () => number
  private readonly sleep: (ms: number) => Promise<void>

  private runs: StoredRun[] = []
  private sessionId: number
  /** The inventory at the last boundary of the run in progress. */
  private runSnapshot: InventorySnapshot | null = null
  /** Inventory readings for run boundaries, done one after another. */
  private pending: Promise<void> = Promise.resolve()
  /** Counts boundaries as they are queued, so a waiting one can tell whether a newer one exists. */
  private boundarySeq = 0
  private readonly tracker = new SanctumTracker({
    onRun: (run) => this.recordRun(run),
    onBoundary: (boundary) => {
      const seq = ++this.boundarySeq
      this.pending = this.pending.then(() => this.readBoundary(boundary, seq)).catch(() => {})
    }
  })
  private tracked: string[] = [...DEFAULT_TRACKED]
  private trackAll = false
  /** The run that just ended, kept on screen while the player is still in the Sanctum lobby. */
  private finishedRunId: number | null = null

  constructor(private readonly deps: SanctumDeps) {
    this.now = deps.now ?? Date.now
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
    this.sessionId = this.now()
    if (deps.runsFile) {
      try {
        const stored = JSON.parse(readFileSync(deps.runsFile, 'utf8')) as { runs?: StoredRun[] }
        if (Array.isArray(stored.runs)) this.runs = stored.runs
      } catch {
        // No history yet.
      }
      // A run that was in progress when the app closed can no longer be followed: it did not finish.
      for (const run of this.runs) {
        if (run.outcome === 'active') {
          run.outcome = 'failed'
          run.endedAt = run.startedAt + durationOf(run)
        }
      }
    }
    if (deps.file) {
      try {
        const stored = JSON.parse(readFileSync(deps.file, 'utf8')) as {
          account?: unknown
          character?: unknown
          autoCharacter?: unknown
          league?: unknown
          tracked?: unknown
          trackAll?: unknown
        }
        if (typeof stored.account === 'string') this.account = stored.account
        if (typeof stored.character === 'string') this.character = stored.character
        if (typeof stored.autoCharacter === 'boolean') this.autoCharacter = stored.autoCharacter
        if (typeof stored.league === 'string') this.league = stored.league
        if (Array.isArray(stored.tracked)) this.tracked = cleanNames(stored.tracked)
        if (typeof stored.trackAll === 'boolean') this.trackAll = stored.trackAll
        // Load prices ahead of the first run, so the tracked currency has its pictures from the start.
        if (this.league) void this.pricesFor(this.league).then(() => this.emit())
        // Relics still waiting for a price when the app was closed get it now.
        for (const run of this.runs) {
          for (const floor of Object.keys(run.loot)) this.priceRelics(run, Number(floor))
        }
      } catch {
        // No saved settings yet.
      }
    }
  }

  view(): SanctumView {
    const prices = this.league ? this.deps.prices.peek(this.league) : null
    return {
      account: this.account,
      character: this.character,
      autoCharacter: this.autoCharacter,
      cookieStored: this.deps.secrets.has(COOKIE),
      canStoreCookie: this.deps.secrets.available,
      status: this.status,
      busy: this.busy,
      snapshots: this.snapshots.map((snapshot) => ({
        takenAt: snapshot.takenAt,
        items: entryCount(snapshot),
        gold: snapshot.gold
      })),
      lastLoot: this.lastLoot,
      prices: prices ? { league: prices.league, fetchedAt: prices.fetchedAt, divineChaos: prices.divineChaos } : null,
      pricesError: this.pricesError,
      tracked: this.tracked.map((name) => ({ name, icon: this.iconOf(name) })),
      trackAll: this.trackAll,
      ...this.runsView()
    }
  }

  // ── Tracked currency ──

  setTracked(names: string[], trackAll: boolean): void {
    this.tracked = cleanNames(names)
    this.trackAll = trackAll === true
    this.saveAccount()
    this.emit()
  }

  /** Every item the price source knows, with pictures: what the player can choose to track. */
  async getCatalog(): Promise<TrackedItem[]> {
    const prices = await this.pricesFor(this.league ?? FALLBACK_LEAGUE)
    this.emit()
    return Object.entries(prices?.icons ?? {})
      .map(([name, icon]) => ({ name, icon }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  /** A picture for the item: from the price source, or from the loot it was seen in. */
  private iconOf(name: string): string | null {
    const prices = this.deps.prices.peek(this.league ?? FALLBACK_LEAGUE)
    if (prices?.icons[name]) return prices.icons[name]
    for (let i = this.runs.length - 1; i >= 0; i--) {
      for (const loot of Object.values(this.runs[i].loot)) {
        const line = loot.lines.find((entry) => entry.name === name)
        if (line?.icon) return line.icon
      }
    }
    return null
  }

  // ── Runs ──

  /** Call for every area the player enters, as seen in the game log. */
  onArea(ts: number, areaId: string, seed: string): void {
    const wasActive = this.tracker.active?.run.id ?? null
    this.tracker.area(ts, areaId, seed)
    const kind = classifyArea(areaId).kind
    if (wasActive !== null && !this.tracker.active && kind === 'lobby') {
      // The run just ended in the lobby: keep showing it until the player moves on.
      this.finishedRunId = wasActive
      this.emit()
    } else if (this.finishedRunId !== null && kind !== 'lobby') {
      this.finishedRunId = null
      this.emit()
    }
  }

  /** Call for every "Speaker: text" line of the game log. */
  onDialogue(ts: number, speaker: string, text: string): void {
    this.tracker.dialogue(ts, speaker, text)
  }

  newSession(): void {
    this.sessionId = this.now()
    this.emit()
  }

  failActive(): void {
    this.tracker.fail(this.now())
  }

  setOutcome(runId: number, outcome: 'completed' | 'failed'): void {
    const run = this.runs.find((entry) => entry.id === runId)
    if (!run || run.outcome === 'active' || run.outcome === outcome) return
    run.outcome = outcome
    // A won run has all its floors behind it; a lost one never finished its last floor.
    const last = Math.max(...run.floors.map((floor) => floor.floor))
    for (const floor of run.floors) floor.done = outcome === 'completed' || floor.floor < last
    this.saveRuns()
    this.emit()
  }

  /** Resolves when every inventory reading asked for so far is done. For tests and shutdown. */
  settled(): Promise<void> {
    return this.pending
  }

  private runsView(): Pick<SanctumView, 'sessionStartedAt' | 'runCounts' | 'runs' | 'active' | 'finished' | 'stats'> {
    const views = this.runs.map(toRunView)
    const ended = views.filter((run) => run.outcome !== 'active')
    const live = this.tracker.active
    const activeRun = live ? views.find((run) => run.id === live.run.id) : undefined
    const midnight = new Date(this.now()).setHours(0, 0, 0, 0)
    return {
      sessionStartedAt: this.sessionId,
      runCounts: {
        session: views.filter((run) => run.sessionId === this.sessionId).length,
        today: views.filter((run) => run.startedAt >= midnight).length
      },
      runs: ended.slice(-RUNS_SHOWN).reverse(),
      active:
        live && activeRun
          ? {
              run: activeRun,
              floor: live.where.kind === 'floor' ? live.where.floor : null,
              room: live.where.kind === 'floor' ? live.where.room : null,
              inSanctum: live.where.kind !== 'outside',
              since: live.since
            }
          : null,
      finished: views.find((run) => run.id === this.finishedRunId) ?? null,
      stats: {
        session: computeTotals(ended.filter((run) => run.sessionId === this.sessionId)),
        allTime: computeTotals(ended)
      }
    }
  }

  /** Stores what the tracker reports about a run, keeping the loot already counted for it. */
  private recordRun(run: TrackedRun): void {
    const copy = structuredClone(run)
    const index = this.runs.findIndex((entry) => entry.id === run.id)
    if (index === -1) {
      this.runs.push({ ...copy, sessionId: this.sessionId, loot: {}, lootNote: null })
    } else {
      this.runs[index] = { ...this.runs[index], ...copy }
    }
    this.saveRuns()
    this.emit()
  }

  /** Reads the inventory at a run boundary and books what was gained to the floor it belongs to. */
  private async readBoundary(boundary: Boundary, seq: number): Promise<void> {
    const run = (): StoredRun | undefined => this.runs.find((entry) => entry.id === boundary.runId)
    // A reading after an ordinary room change is dropped when a newer one is already queued
    // (it will find the same items) or when the half-hour allowance is nearly used up.
    const skip = (): boolean =>
      !boundary.required &&
      (seq !== this.boundarySeq || this.deps.site.requestsWithin(HALF_HOUR_MS) >= OPTIONAL_BUDGET)
    if (skip()) return
    const ready = this.account && this.deps.secrets.has(COOKIE) && (this.character || this.autoCharacter)
    if (!ready) {
      const stored = run()
      if (stored) stored.lootNote = 'Лут не посчитан: не настроен доступ к инвентарю.'
      return
    }

    await this.sleep(BOUNDARY_DELAY_MS)
    if (skip()) return
    // The player may have switched characters since the last run: look once per run.
    if (this.autoCharacter && this.characterCheckedFor !== boundary.runId) {
      this.characterCheckedFor = boundary.runId
      await this.detectCharacter()
    }
    const snapshot = await this.request()
    const stored = run()
    if (!snapshot) {
      if (stored) stored.lootNote = `Лут посчитан не полностью: ${this.status?.message ?? 'сайт не ответил'}`
      this.saveRuns()
      this.emit()
      return
    }

    const previous = this.runSnapshot
    this.runSnapshot = snapshot
    if (boundary.kind === 'collect' && previous && stored) {
      const prices = await this.pricesFor(snapshot.league)
      const gained = valueLoot(diffSnapshots(previous, snapshot), prices)
      stored.loot[boundary.floor] = mergeLoot(stored.loot[boundary.floor] ?? null, gained)
      this.priceRelics(stored, boundary.floor)
    }
    this.status = null
    this.saveRuns()
    this.emit()
  }

  /** Sends every relic of the floor that has no price yet to be priced; prices arrive later. */
  private priceRelics(run: StoredRun, floor: number): void {
    const league = this.league
    for (const line of run.loot[floor]?.lines ?? []) {
      const relic = line.relic
      if (!relic || relic.pricing !== 'pending') continue
      if (!this.deps.relics || !league) {
        relic.pricing = 'none'
        relic.note = 'Оценка реликвий недоступна.'
        continue
      }
      void this.deps.relics.price(relic, league).then((price) => {
        const loot = run.loot[floor]
        const target = loot?.lines.find((entry) => entry.relic?.itemId === relic.itemId)
        if (!loot || !target?.relic) return
        target.chaos = price.chaos
        target.relic.pricing = price.pricing
        target.relic.note = price.note
        run.loot[floor] = retotal(loot, this.deps.prices.peek(league)?.divineChaos ?? null)
        this.saveRuns()
        this.emit()
      })
    }
  }

  private async pricesFor(league: string | null) {
    if (!league) return null
    try {
      const prices = await this.deps.prices.get(league)
      this.pricesError = null
      return prices
    } catch (error) {
      this.pricesError = error instanceof Error ? error.message : 'Не удалось получить цены.'
      return null
    }
  }

  private saveRuns(): void {
    if (!this.deps.runsFile) return
    try {
      mkdirSync(dirname(this.deps.runsFile), { recursive: true })
      writeFileSync(this.deps.runsFile, JSON.stringify({ runs: this.runs }))
    } catch {
      // The history is not worth interrupting a run for.
    }
  }

  // ── Access and manual snapshots ──

  /** Saves the access settings, then checks them with a real request. */
  async saveAccess(access: SanctumAccess): Promise<void> {
    const account = String(access.account ?? '').trim()
    this.autoCharacter = access.autoCharacter !== false
    if (account !== this.account) this.setCharacter('')
    this.account = account
    if (!this.autoCharacter) this.setCharacter(String(access.character ?? '').trim())
    this.saveAccount()

    if (access.cookie !== undefined && access.cookie.trim() !== '') {
      const cookie = normalizeCookie(access.cookie)
      if (!cookie) return this.fail('Это не похоже на POESESSID: в ней 32 символа из цифр и букв a–f.')
      if (!this.deps.secrets.set(COOKIE, cookie)) {
        return this.fail('Система не даёт зашифровать cookie, поэтому она не сохранена.')
      }
    }

    if (this.autoCharacter && !(await this.detectCharacter())) return
    const snapshot = await this.request()
    if (snapshot) {
      const gold = snapshot.gold != null ? `, золото: ${snapshot.gold}` : ''
      this.done(
        `Доступ есть: ${this.character} — ${snapshot.characterClass ?? 'персонаж'} ${snapshot.level ?? '?'} ур., ` +
          `лига ${snapshot.league ?? '?'}. В инвентаре позиций: ${entryCount(snapshot)}${gold}.`
      )
    }
  }

  /**
   * Finds out which character is being played: the one that logged in last. Returns false,
   * with the reason reported, when the site could not say.
   */
  private async detectCharacter(): Promise<boolean> {
    const cookie = this.deps.secrets.get(COOKIE)
    if (!this.account || !cookie) {
      this.fail(this.account ? 'Нет сохранённой cookie: без неё сайт не показывает инвентарь.' : 'Укажи имя аккаунта.')
      return false
    }
    try {
      const name = lastPlayedCharacter(await this.deps.site.getCharacters(this.account, cookie))
      if (!name) {
        this.fail('Сайт не вернул список персонажей: проверь имя аккаунта (с #цифрами).')
        return false
      }
      if (name !== this.character) {
        this.setCharacter(name)
        this.saveAccount()
      }
      return true
    } catch (error) {
      this.fail(error instanceof SiteError ? error.message : 'Запрос к сайту не удался.')
      return false
    }
  }

  private setCharacter(name: string): void {
    if (name === this.character) return
    this.character = name
    // Snapshots of another character cannot be compared with this one's.
    this.snapshots = []
    this.lastLoot = null
    this.runSnapshot = null
  }

  private saveAccount(): void {
    if (!this.deps.file) return
    mkdirSync(dirname(this.deps.file), { recursive: true })
    writeFileSync(
      this.deps.file,
      JSON.stringify(
        {
          account: this.account,
          character: this.character,
          autoCharacter: this.autoCharacter,
          league: this.league,
          tracked: this.tracked,
          trackAll: this.trackAll
        },
        null,
        2
      )
    )
  }

  clearCookie(): void {
    this.deps.secrets.delete(COOKIE)
    this.status = null
    this.emit()
  }

  /** Takes a snapshot and works out what was gained since the previous one. */
  async snapshot(): Promise<void> {
    const snapshot = await this.request()
    if (!snapshot) return
    const previous = this.snapshots[this.snapshots.length - 1]
    this.snapshots = [...this.snapshots, snapshot].slice(-SNAPSHOTS_KEPT)

    if (previous) {
      this.lastLoot = valueLoot(diffSnapshots(previous, snapshot), await this.pricesFor(snapshot.league))
    }
    this.done(previous ? 'Снимок сделан, разница посчитана.' : 'Первый снимок сделан — с ним будет сравниваться следующий.')
  }

  /**
   * Saves the site's raw answer about the character to a file, to see what else it exposes
   * (it holds the character's items, never the cookie). Returns the file path, or null on failure.
   */
  async dumpSiteAnswer(): Promise<string | null> {
    const cookie = this.deps.secrets.get(COOKIE)
    if (!this.deps.debugDir || !cookie || !this.account || !this.character) {
      this.fail('Сначала настрой доступ к инвентарю.')
      return null
    }
    try {
      const body = await this.deps.site.getItems(this.account, this.character, cookie)
      mkdirSync(this.deps.debugDir, { recursive: true })
      const file = join(this.deps.debugDir, `site-answer-${this.now()}.json`)
      writeFileSync(file, JSON.stringify(body, null, 1))
      this.done(`Ответ сайта сохранён: ${file}`)
      return file
    } catch (error) {
      this.fail(error instanceof SiteError ? error.message : 'Запрос к сайту не удался.')
      return null
    }
  }

  /** One request for the inventory. On failure reports the reason and returns null. */
  private async request(): Promise<InventorySnapshot | null> {
    if (this.busy) return null
    if (!this.account || !this.character) {
      this.fail(this.autoCharacter ? 'Не удалось определить персонажа: проверь доступ.' : 'Укажи имя аккаунта и персонажа.')
      return null
    }
    const cookie = this.deps.secrets.get(COOKIE)
    if (!cookie) {
      this.fail('Нет сохранённой cookie: без неё сайт не показывает инвентарь.')
      return null
    }

    this.busy = true
    this.emit()
    let snapshot: InventorySnapshot | null = null
    let problem = 'Сайт не вернул персонажа: проверь имя аккаунта (с #цифрами) и персонажа.'
    try {
      snapshot = toSnapshot(await this.deps.site.getItems(this.account, this.character, cookie), this.now())
    } catch (error) {
      problem = error instanceof SiteError ? error.message : 'Запрос к сайту не удался.'
    }
    this.busy = false
    if (!snapshot) {
      this.fail(problem)
      return null
    }
    if (snapshot.league && snapshot.league !== this.league) {
      this.league = snapshot.league
      this.saveAccount()
      void this.pricesFor(this.league).then(() => this.emit())
    }
    return snapshot
  }

  private fail(message: string): void {
    this.status = { ok: false, message }
    this.emit()
  }

  private done(message: string): void {
    this.status = { ok: true, message }
    this.emit()
  }

  private emit(): void {
    this.deps.onChange?.(this.view())
  }
}

function durationOf(run: TrackedRun): number {
  return run.floors.reduce((sum, floor) => sum + floor.ms, 0) + run.transitMs
}

function cleanNames(names: unknown[]): string[] {
  const clean = names.filter((name): name is string => typeof name === 'string').map((name) => name.trim())
  return [...new Set(clean.filter(Boolean))].slice(0, 40)
}

function toRunView(run: StoredRun): RunView {
  // Runs saved before room times were recorded have none.
  const floors = run.floors.map((floor) => ({ ...floor, roomMs: floor.roomMs ?? [], loot: run.loot[floor.floor] ?? null }))
  return {
    id: run.id,
    sessionId: run.sessionId,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    outcome: run.outcome,
    floors,
    transitMs: run.transitMs,
    durationMs: durationOf(run),
    loot: floors.reduce<LootValue | null>((sum, floor) => (floor.loot ? mergeLoot(sum, floor.loot) : sum), null) ?? EMPTY_LOOT,
    lootNote: run.lootNote
  }
}
