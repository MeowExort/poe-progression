/** One kind of item gained, e.g. 3 × Divine Orb. */
export interface LootLine {
  name: string
  count: number
  /** Value of the whole line in Chaos Orbs; null when there is no price for the item. */
  chaos: number | null
}

export interface LootValue {
  lines: LootLine[]
  gold: number
  /** Sum of the priced lines, in Chaos Orbs. */
  chaos: number
  /** The same sum in Divine Orbs; null when the Divine price is unknown. */
  divine: number | null
  /** How many lines have no price and are not part of the sums. */
  unpriced: number
}

export interface SnapshotInfo {
  takenAt: number
  /** Occupied inventory cells' worth of distinct entries: stacks plus single items. */
  items: number
  gold: number | null
}

export interface PricesInfo {
  league: string
  fetchedAt: number
  /** Chaos Orbs per Divine Orb. */
  divineChaos: number | null
}

export interface SanctumView {
  account: string
  character: string
  cookieStored: boolean
  /** False when the operating system offers no way to encrypt the cookie; it is not stored then. */
  canStoreCookie: boolean
  /** Result of the last request to the site, for the player. */
  status: { ok: boolean; message: string } | null
  busy: boolean
  /** Inventory snapshots taken this session, oldest first. */
  snapshots: SnapshotInfo[]
  /** What was gained between the two latest snapshots. */
  lastLoot: LootValue | null
  prices: PricesInfo | null
  pricesError: string | null
}

export interface SanctumAccess {
  account: string
  character: string
  /** A new session cookie; omit to keep the stored one. */
  cookie?: string
}

export interface SanctumApi {
  get(): Promise<SanctumView>
  onChange(listener: (view: SanctumView) => void): () => void
  /** Saves the access settings and immediately checks them against the site. */
  saveAccess(access: SanctumAccess): Promise<void>
  clearCookie(): Promise<void>
  /** Takes an inventory snapshot and compares it with the previous one. */
  snapshot(): Promise<void>
}

export const SANCTUM_IPC = {
  get: 'sanctum:get',
  state: 'sanctum:state',
  saveAccess: 'sanctum:save-access',
  clearCookie: 'sanctum:clear-cookie',
  snapshot: 'sanctum:snapshot'
} as const
