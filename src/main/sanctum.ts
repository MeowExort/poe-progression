import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { diffSnapshots, entryCount, toSnapshot, type InventorySnapshot } from '@core/sanctum/inventory'
import { valueLoot } from '@core/sanctum/prices'
import type { LootValue, SanctumAccess, SanctumView } from '@shared/sanctum'
import { normalizeCookie, SiteError, type PoeSite } from './poe-site'
import type { PriceBook } from './prices'
import type { SecretStore } from './secrets'

const COOKIE = 'poesessid'
const SNAPSHOTS_KEPT = 20

export interface SanctumDeps {
  /** Where the account and character names are kept (they are not secret). */
  file: string | null
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

  constructor(private readonly deps: SanctumDeps) {
    this.now = deps.now ?? Date.now
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
      pricesError: this.pricesError
    }
  }

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
      const loot = diffSnapshots(previous, snapshot)
      let prices = null
      if (snapshot.league) {
        try {
          prices = await this.deps.prices.get(snapshot.league)
          this.pricesError = null
        } catch (error) {
          this.pricesError = error instanceof Error ? error.message : 'Не удалось получить цены.'
        }
      }
      this.lastLoot = valueLoot(loot, prices)
    }
    this.done(previous ? 'Снимок сделан, разница посчитана.' : 'Первый снимок сделан — с ним будет сравниваться следующий.')
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
