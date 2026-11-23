import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { diffSnapshots, entryCount, toSnapshot, type InventorySnapshot } from '@core/sanctum/inventory'
import { valueLoot } from '@core/sanctum/prices'
import { SanctumTracker, type Boundary, type TrackedRun } from '@core/sanctum/runs'
import { computeTotals, EMPTY_LOOT, mergeLoot } from '@core/sanctum/stats'
import type { LootValue, RunView, SanctumAccess, SanctumView } from '@shared/sanctum'
import { normalizeCookie, SiteError, type PoeSite } from './poe-site'
import type { PriceBook } from './prices'
import type { SecretStore } from './secrets'

const COOKIE = 'poesessid'
const SNAPSHOTS_KEPT = 20
const RUNS_SHOWN = 100
/** The site learns about the inventory when the character changes area; give it a moment to catch up. */
const BOUNDARY_DELAY_MS = 3000

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
  onChange?: (view: SanctumView) => void
  now?: () => number
}

/** Loot tracking: access to the character's inventory, snapshots of it and what was gained between them. */
export class SanctumService {
  private account = ''
  private character = ''
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
  private readonly tracker = new SanctumTracker({
    onRun: (run) => this.recordRun(run),
    onBoundary: (boundary) => {
      this.pending = this.pending.then(() => this.readBoundary(boundary)).catch(() => {})
    }
  })

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
        const stored = JSON.parse(readFileSync(deps.file, 'utf8')) as { account?: unknown; character?: unknown }
        if (typeof stored.account === 'string') this.account = stored.account
        if (typeof stored.character === 'string') this.character = stored.character
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
      ...this.runsView()
    }
  }

  // ── Runs ──

  /** Call for every area the player enters, as seen in the game log. */
  onArea(ts: number, areaId: string, seed: string): void {
    this.tracker.area(ts, areaId, seed)
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

  private runsView(): Pick<SanctumView, 'sessionStartedAt' | 'runs' | 'active' | 'stats'> {
    const views = this.runs.map(toRunView)
    const ended = views.filter((run) => run.outcome !== 'active')
    const live = this.tracker.active
    const activeRun = live ? views.find((run) => run.id === live.run.id) : undefined
    return {
      sessionStartedAt: this.sessionId,
      runs: ended.slice(-RUNS_SHOWN).reverse(),
      active:
        live && activeRun
          ? {
              run: activeRun,
              floor: live.where.kind === 'floor' ? live.where.floor : null,
              inSanctum: live.where.kind !== 'outside',
              since: live.since
            }
          : null,
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
  private async readBoundary(boundary: Boundary): Promise<void> {
    const run = (): StoredRun | undefined => this.runs.find((entry) => entry.id === boundary.runId)
    if (!this.account || !this.character || !this.deps.secrets.has(COOKIE)) {
      const stored = run()
      if (stored) stored.lootNote = 'Лут не посчитан: не настроен доступ к инвентарю.'
      return
    }

    await this.sleep(BOUNDARY_DELAY_MS)
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
    }
    this.status = null
    this.saveRuns()
    this.emit()
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
    const character = String(access.character ?? '').trim()
    if (account !== this.account || character !== this.character) {
      // Snapshots of another character cannot be compared with this one's.
      this.snapshots = []
      this.lastLoot = null
    }
    this.account = account
    this.character = character
    if (this.deps.file) {
      mkdirSync(dirname(this.deps.file), { recursive: true })
      writeFileSync(this.deps.file, JSON.stringify({ account, character }, null, 2))
    }

    if (access.cookie !== undefined && access.cookie.trim() !== '') {
      const cookie = normalizeCookie(access.cookie)
      if (!cookie) return this.fail('Это не похоже на POESESSID: в ней 32 символа из цифр и букв a–f.')
      if (!this.deps.secrets.set(COOKIE, cookie)) {
        return this.fail('Система не даёт зашифровать cookie, поэтому она не сохранена.')
      }
    }

    const snapshot = await this.request()
    if (snapshot) {
      const gold = snapshot.gold != null ? `, золото: ${snapshot.gold}` : ''
      this.done(
        `Доступ есть: ${snapshot.characterClass ?? 'персонаж'} ${snapshot.level ?? '?'} ур., лига ${snapshot.league ?? '?'}. ` +
          `В инвентаре позиций: ${entryCount(snapshot)}${gold}.`
      )
    }
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
      this.fail('Укажи имя аккаунта и персонажа.')
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
    this.league = snapshot.league
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

function toRunView(run: StoredRun): RunView {
  const floors = run.floors.map((floor) => ({ ...floor, loot: run.loot[floor.floor] ?? null }))
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
