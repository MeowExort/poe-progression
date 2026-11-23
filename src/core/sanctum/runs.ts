/**
 * Recognises Forbidden Sanctum runs from the areas and dialogue seen in the game log.
 *
 * What a run looks like in the log (area ids):
 *   SanctumFoyer_Fellshrine      the lobby, "The Forbidden Sanctum"; revisited between floors
 *   SanctumFoyer_<floor>_<n>     the entrance of a floor
 *   SanctumCellar | SanctumVaults | SanctumNave | SanctumCrypt   rooms of floors 1 to 4, eight each
 * The run is won when Lycia, Herald of the Scourge speaks one of her dying lines in the last room.
 * The log has no line for losing all Resolve, so a run counts as failed once a new one begins
 * without that, or when the player says so.
 */

export type RunOutcome = 'active' | 'completed' | 'failed'

export interface TrackedFloor {
  floor: number
  /** Distinct rooms entered. */
  rooms: number
  /** Time spent in each room, in the order they were entered. */
  roomMs: number[]
  /** Time spent on the floor: its entrance and rooms. */
  ms: number
  /** True once the floor is behind: the next floor was reached or the run was won. */
  done: boolean
}

export interface TrackedRun {
  /** Start time; unique enough to identify the run. */
  id: number
  startedAt: number
  endedAt: number | null
  outcome: RunOutcome
  floors: TrackedFloor[]
  /** Time in the lobby between floors. */
  transitMs: number
}

/** Where the clock is running right now. `room` is an index into the floor's rooms; null at its entrance. */
export type Where = { kind: 'floor'; floor: number; room: number | null } | { kind: 'lobby' } | { kind: 'outside' }

/** A moment at which the character's inventory should be read to count loot. */
export interface Boundary {
  runId: number
  /** The floor the loot gained so far belongs to. */
  floor: number
  /** "baseline": remember the inventory. "collect": what was gained since the last reading is loot. */
  kind: 'baseline' | 'collect'
  /**
   * False for the reading after an ordinary room change: it only makes the loot show up sooner
   * and may be skipped, because the next reading will find the same items.
   */
  required: boolean
}

/** Everything the tracker knows about a run in progress, to carry it over a restart. */
export interface TrackerState {
  run: TrackedRun
  where: Where
  since: number
  entranceSeed: string | null
  lastRoomSeed: string | null
  wonAt: number | null
  away: boolean
}

export interface TrackerOptions {
  onRun?: (run: TrackedRun) => void
  onBoundary?: (boundary: Boundary) => void
}

const LOBBY = 'SanctumFoyer_Fellshrine'
const ROOMS: Record<string, number> = { SanctumCellar: 1, SanctumVaults: 2, SanctumNave: 3, SanctumCrypt: 4 }
const LAST_FLOOR = 4
const FINAL_BOSS = 'Lycia, Herald of the Scourge'
/** Her lines on death (list from the TraXile project, confirmed against a real run). */
const DEATH_LINES = new Set([
  '*laughter*',
  'You have accomplished nothing... I have achieved eternal life...',
  'You are only delaying the inevitable.',
  'I cannot die. You know this.',
  'Beidat beckons just beyond the door...',
  "You've accomplished nothing."
])

type AreaKind = { kind: 'lobby' } | { kind: 'entrance'; floor: number } | { kind: 'room'; floor: number } | { kind: 'outside' }

export function classifyArea(areaId: string): AreaKind {
  if (areaId === LOBBY) return { kind: 'lobby' }
  const entrance = /^SanctumFoyer_(\d)_/.exec(areaId)
  if (entrance) return { kind: 'entrance', floor: +entrance[1] }
  const room = Object.keys(ROOMS).find((prefix) => areaId.startsWith(prefix))
  return room ? { kind: 'room', floor: ROOMS[room] } : { kind: 'outside' }
}

export class SanctumTracker {
  private run: TrackedRun | null = null
  private where: Where = { kind: 'outside' }
  private since = 0
  /** Seed of the floor-1 entrance: a different one means a different run. */
  private entranceSeed: string | null = null
  private lastRoomSeed: string | null = null
  /** When the final boss died; the run is closed on leaving her room. */
  private wonAt: number | null = null
  /** True after the player left the Sanctum mid-run: the inventory may have changed in the hideout. */
  private away = false

  constructor(private readonly options: TrackerOptions = {}) {}

  /** The run in progress and where its clock is running, for live timers. */
  get active(): { run: TrackedRun; where: Where; since: number } | null {
    return this.run ? { run: this.run, where: this.where, since: this.since } : null
  }

  /** The run in progress as plain data, or null between runs. */
  state(): TrackerState | null {
    if (!this.run) return null
    return structuredClone({
      run: this.run,
      where: this.where,
      since: this.since,
      entranceSeed: this.entranceSeed,
      lastRoomSeed: this.lastRoomSeed,
      wonAt: this.wonAt,
      away: this.away
    })
  }

  /** Continues a run saved by `state()`, as if the tracker had never stopped. */
  restore(state: TrackerState): void {
    const copy = structuredClone(state)
    this.run = copy.run
    this.where = copy.where
    this.since = copy.since
    this.entranceSeed = copy.entranceSeed
    this.lastRoomSeed = copy.lastRoomSeed
    this.wonAt = copy.wonAt
    this.away = copy.away
  }

  /** Forgets the run in progress without reporting it as finished. */
  drop(): void {
    this.run = null
    this.wonAt = null
    this.away = false
    this.where = { kind: 'outside' }
  }

  /** Feed every area the player enters, in order. */
  area(ts: number, areaId: string, seed: string): void {
    const area = classifyArea(areaId)
    this.tick(ts)

    if (area.kind === 'entrance') {
      const run = this.run
      const startsOver =
        run !== null &&
        (area.floor < this.currentFloor() ||
          (area.floor === 1 && seed !== this.entranceSeed && run.floors.some((floor) => floor.rooms > 0)))
      if (startsOver) this.finish('failed', ts)
      if (!this.run) {
        // Joining a run halfway (the app was started late) would give wrong times: wait for a fresh one.
        if (area.floor !== 1) return this.move({ kind: 'outside' }, ts)
        this.start(ts, seed)
      } else {
        this.returnFromAway(area.floor)
      }
      this.enterFloor(area.floor)
      this.move({ kind: 'floor', floor: area.floor, room: null }, ts)
      return this.emit()
    }

    if (!this.run) return this.move({ kind: 'outside' }, ts)

    if (area.kind === 'room') {
      // Coming from another room of this floor: the loot picked up there is in the inventory now.
      // Reading it is optional — it only shows the loot a room earlier.
      const from = this.where
      if (from.kind === 'floor' && from.room !== null) this.boundary(from.floor, 'collect', false)
      this.returnFromAway(area.floor)
      const floor = this.enterFloor(area.floor)
      if (seed !== this.lastRoomSeed) {
        floor.rooms++
        floor.roomMs.push(0)
      }
      this.lastRoomSeed = seed
      // Move first, report second: whoever hears about the run must see where the clock is now.
      this.move({ kind: 'floor', floor: area.floor, room: floor.roomMs.length - 1 }, ts)
      return this.emit()
    }

    // Leaving the floors: to the lobby or out of the Sanctum altogether.
    const from = this.where
    if (from.kind === 'floor') this.boundary(from.floor, 'collect')
    if (this.wonAt !== null) return this.finish('completed', ts)
    if (area.kind === 'outside') this.away = true
    this.move(area.kind === 'lobby' ? { kind: 'lobby' } : { kind: 'outside' }, ts)
    this.emit()
  }

  /** Feed every "Speaker: text" line. */
  dialogue(ts: number, speaker: string, text: string): void {
    if (!this.run || this.wonAt !== null) return
    if (this.where.kind !== 'floor' || this.where.floor !== LAST_FLOOR) return
    if (speaker === FINAL_BOSS && DEATH_LINES.has(text)) this.wonAt = ts
  }

  /** Closes the run in progress as failed, e.g. when the player says the Resolve ran out. */
  fail(ts: number): void {
    if (!this.run) return
    this.tick(ts)
    if (this.where.kind === 'floor') this.boundary(this.where.floor, 'collect')
    this.finish('failed', ts)
  }

  // ── internals ──

  private start(ts: number, seed: string): void {
    this.run = { id: ts, startedAt: ts, endedAt: null, outcome: 'active', floors: [], transitMs: 0 }
    this.entranceSeed = seed
    this.lastRoomSeed = null
    this.wonAt = null
    this.away = false
    this.boundary(1, 'baseline')
  }

  /** Back from the hideout: whatever was stashed or taken there must not be counted as loot. */
  private returnFromAway(floor: number): void {
    if (!this.away) return
    this.away = false
    this.boundary(floor, 'baseline')
  }

  private finish(outcome: 'completed' | 'failed', ts: number): void {
    const run = this.run
    if (!run) return
    run.outcome = outcome
    run.endedAt = ts
    if (outcome === 'completed') for (const floor of run.floors) floor.done = true
    this.run = null
    this.wonAt = null
    this.where = { kind: 'outside' }
    this.since = ts
    this.options.onRun?.(run)
  }

  /** Adds the time since the last event to whatever the player was in. */
  private tick(ts: number): void {
    const run = this.run
    if (run) {
      const elapsed = Math.max(0, ts - this.since)
      if (this.where.kind === 'floor') {
        const { floor: current, room } = this.where
        const floor = run.floors.find((entry) => entry.floor === current)
        if (floor) {
          floor.ms += elapsed
          if (room !== null && room < floor.roomMs.length) floor.roomMs[room] += elapsed
        }
      } else if (this.where.kind === 'lobby') {
        run.transitMs += elapsed
      }
    }
    this.since = ts
  }

  private move(where: Where, ts: number): void {
    this.where = where
    this.since = ts
  }

  private currentFloor(): number {
    return this.run?.floors.reduce((highest, floor) => Math.max(highest, floor.floor), 0) ?? 0
  }

  private enterFloor(number: number): TrackedFloor {
    const run = this.run!
    let floor = run.floors.find((entry) => entry.floor === number)
    if (!floor) {
      for (const earlier of run.floors) earlier.done = true
      floor = { floor: number, rooms: 0, roomMs: [], ms: 0, done: false }
      run.floors.push(floor)
    }
    return floor
  }

  private boundary(floor: number, kind: Boundary['kind'], required = true): void {
    if (this.run) this.options.onBoundary?.({ runId: this.run.id, floor, kind, required })
  }

  private emit(): void {
    if (this.run) this.options.onRun?.(this.run)
  }
}
