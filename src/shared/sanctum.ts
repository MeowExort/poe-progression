/** One kind of item gained, e.g. 3 × Divine Orb. */
export interface LootLine {
  name: string
  count: number
  /** Picture of the item from the game's CDN, when known. */
  icon: string | null
  /** True for currency items (orbs, shards and the like). */
  currency: boolean
  /** Set for a Sanctum relic: every relic is its own line, priced by its modifiers. */
  relic?: RelicLine
  /** Value of the whole line in Chaos Orbs; null when there is no price for the item. */
  chaos: number | null
}

export interface RelicLine {
  /** The item's id on the site; tells two relics of the same name apart. */
  itemId: string
  baseType: string
  unique: string | null
  mods: string[]
  /**
   * "pending": waiting for the trade site. "priced": `chaos` holds the estimate.
   * "none": nothing comparable is on sale. "failed": the trade site could not be asked.
   */
  pricing: 'pending' | 'priced' | 'none' | 'failed'
  /** How the price was arrived at, or why there is none; ready to show. */
  note: string | null
  /** The trade search behind the verdict, to open in a browser. */
  tradeUrl?: string | null
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

export type RunOutcome = 'active' | 'completed' | 'failed'

export interface FloorView {
  floor: number
  /** Distinct rooms entered, out of eight. */
  rooms: number
  /** Time spent in each room, in the order they were entered. */
  roomMs: number[]
  ms: number
  /** True once the floor is behind: the next one was reached or the run was won. */
  done: boolean
  loot: LootValue | null
}

export interface RunView {
  /** Start time; identifies the run. */
  id: number
  sessionId: number
  startedAt: number
  endedAt: number | null
  outcome: RunOutcome
  floors: FloorView[]
  /** Time in the lobby between floors. */
  transitMs: number
  /** Floors plus lobby time; breaks outside the Sanctum are not part of it. */
  durationMs: number
  loot: LootValue
  /** Why loot is missing or incomplete, if it is. */
  lootNote: string | null
}

/** Figures over a set of finished runs. */
export interface SanctumTotals {
  runs: number
  completed: number
  failed: number
  /** Average length of a completed run. */
  avgRunMs: number | null
  /** Average length of a finished floor, any floor. */
  avgFloorMs: number | null
  /** The same per floor, index 0 is the first floor. */
  avgFloorMsByFloor: (number | null)[]
  /** Total time spent inside the Sanctum in these runs. */
  sanctumMs: number
  /** Loot value in Chaos Orbs and in Divine Orbs. */
  chaos: number
  divine: number | null
  gold: number
  /** How many of each currency item were picked up, by name. */
  currency: Record<string, number>
}

/** An item the player chose to keep an eye on. */
export interface TrackedItem {
  name: string
  icon: string | null
}

export interface SanctumView {
  account: string
  character: string
  /** True while the character is picked automatically: the one that logged in last. */
  autoCharacter: boolean
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
  /** The currency shown in the overlay and the statistics, in the player's order. */
  tracked: TrackedItem[]
  /** True when every currency that drops is shown, after the tracked ones. */
  trackAll: boolean
  sessionStartedAt: number
  /** Runs started, including one in progress. */
  runCounts: { session: number; today: number }
  /** Finished runs, newest first. */
  runs: RunView[]
  /**
   * The run in progress. `floor` and `room` say where the clock is running since `since`:
   * `floor` is null in the lobby or outside, `room` (an index) is null at a floor's entrance.
   */
  active: { run: RunView; floor: number | null; room: number | null; inSanctum: boolean; since: number } | null
  /** The run that just ended, while the player is still in the Sanctum lobby; null otherwise. */
  finished: RunView | null
  /** Totals of the ended runs: of the session, of those begun today (since midnight), of all. */
  stats: { session: SanctumTotals; today: SanctumTotals; allTime: SanctumTotals }
}

export interface SanctumAccess {
  account: string
  /** Ignored while `autoCharacter` is on. */
  character: string
  autoCharacter: boolean
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
  /** Sets which currency is tracked, in order, and whether all other currency is shown too. */
  setTracked(names: string[], trackAll: boolean): Promise<void>
  /** Every currency item known to poe.ninja, for choosing what to track. */
  getCatalog(): Promise<TrackedItem[]>
  /** Starts counting session statistics from now. */
  newSession(): Promise<void>
  /** Closes the run in progress as failed: the log has no line for losing all Resolve. */
  failActive(): Promise<void>
  /** Saves the site's raw answer about the character to a file and resolves to its path, or null on failure. */
  dumpSiteAnswer(): Promise<string | null>
  /** Corrects how a finished run ended. */
  setOutcome(runId: number, outcome: 'completed' | 'failed'): Promise<void>
  /** Removes a finished run from the history and from every statistic, for good. */
  deleteRun(runId: number): Promise<void>
}

export const SANCTUM_IPC = {
  get: 'sanctum:get',
  state: 'sanctum:state',
  saveAccess: 'sanctum:save-access',
  clearCookie: 'sanctum:clear-cookie',
  snapshot: 'sanctum:snapshot',
  newSession: 'sanctum:new-session',
  failActive: 'sanctum:fail-active',
  setOutcome: 'sanctum:set-outcome',
  deleteRun: 'sanctum:delete-run',
  dumpSiteAnswer: 'sanctum:dump-site-answer',
  setTracked: 'sanctum:set-tracked',
  getCatalog: 'sanctum:get-catalog'
} as const
