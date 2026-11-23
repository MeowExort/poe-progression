import type { SessionState } from '@shared/api'
import type { AreaGeneratedEvent, FeedEntry, LogEvent } from '@shared/events'

const FEED_LIMIT = 200
const UNKNOWN_LIMIT = 200

export interface SessionOptions {
  now?: () => number
  onChange?: (state: SessionState) => void
  /** Called for every live event worth keeping in the history file. */
  onRecord?: (entry: FeedEntry) => void
}

/** Folds log events into the current play state. Knows nothing about Electron or files. */
export class Session {
  private state: SessionState
  private pendingArea: AreaGeneratedEvent | null = null
  private nextId = 1
  private readonly now: () => number
  private readonly onChange?: (state: SessionState) => void
  private readonly onRecord?: (entry: FeedEntry) => void

  constructor(options: SessionOptions = {}) {
    this.now = options.now ?? Date.now
    this.onChange = options.onChange
    this.onRecord = options.onRecord
    this.state = {
      log: { path: '', found: false, size: null, modifiedAt: null, liveLines: 0, lastLineAt: null },
      hotkey: { accelerator: '', registered: false },
      overlay: { layout: 'panel', visible: false, editing: false, bounds: { x: 0, y: 0, width: 0, height: 0 } },
      startedAt: this.now(),
      character: null,
      area: null,
      afk: false,
      deaths: 0,
      areasEntered: 0,
      feed: [],
      unknown: []
    }
  }

  getState(): SessionState {
    return this.state
  }

  /** Merges app-level status (log file, hotkey, overlay) into the state. */
  patch(patch: Partial<Pick<SessionState, 'log' | 'hotkey' | 'overlay'>>): void {
    this.state = { ...this.state, ...patch }
    this.onChange?.(this.state)
  }

  /** Forgets the character and area, e.g. when another log file is selected. */
  reset(): void {
    this.pendingArea = null
    this.state = {
      ...this.state,
      startedAt: this.now(),
      character: null,
      area: null,
      afk: false,
      deaths: 0,
      areasEntered: 0,
      feed: [],
      unknown: []
    }
    this.onChange?.(this.state)
  }

  /**
   * Applies events read from the log.
   * @param live false for lines that were already in the file at startup: they restore the
   *   character and area but are not counted, shown in the feed or written to history.
   */
  apply(events: LogEvent[], live: boolean): void {
    if (!events.length) return
    const s: SessionState = { ...this.state, feed: [...this.state.feed], unknown: [...this.state.unknown] }

    for (const e of events) {
      switch (e.type) {
        case 'area_generated':
          this.pendingArea = e
          break

        case 'area_entered': {
          const generated = this.pendingArea
          this.pendingArea = null
          const entered: LogEvent = {
            ...e,
            level: generated?.level,
            areaId: generated?.areaId,
            seed: generated?.seed
          }
          s.area = {
            name: e.name,
            areaId: generated?.areaId ?? null,
            level: generated?.level ?? null,
            seed: generated?.seed ?? null,
            enteredAt: e.ts
          }
          if (live) {
            s.areasEntered++
            this.record(s, entered)
          }
          break
        }

        case 'level_up':
          s.character = { name: e.character, class: e.class, level: e.level }
          if (live) this.record(s, e)
          break

        case 'death':
          if (live) {
            s.deaths++
            this.record(s, e)
          }
          break

        case 'afk':
          s.afk = e.on
          break

        case 'dialogue':
          if (live) this.push(s.feed, e, FEED_LIMIT)
          break

        case 'system':
          if (live) this.push(s.unknown, e, UNKNOWN_LIMIT)
          break
      }
    }

    this.state = s
    this.onChange?.(s)
  }

  private record(s: SessionState, e: LogEvent): void {
    const entry = this.push(s.feed, e, FEED_LIMIT)
    this.onRecord?.(entry)
  }

  private push(list: FeedEntry[], e: LogEvent, limit: number): FeedEntry {
    const entry: FeedEntry = { ...e, id: this.nextId++ }
    list.push(entry)
    if (list.length > limit) list.splice(0, list.length - limit)
    return entry
  }
}
