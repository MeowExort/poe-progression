import type { FeedEntry } from './events'
import type { FilterApi } from './filter'
import type { PlanApi } from './plan'
import type { SanctumApi } from './sanctum'
import type { UpdateApi } from './update'

export interface AppConfig {
  /** Absolute path to Client.txt. Empty until detected or chosen. */
  logPath: string
  /** True while the path is picked automatically (the most recently written Client.txt found). */
  logPathAuto: boolean
  /** Electron accelerator, e.g. "Shift+F". */
  overlayHotkey: string
  /** False when the player only wants the Sanctum bar and no side panel. */
  overlayPanelEnabled: boolean
  /** Where the player put each overlay layout; null means the default place. */
  overlayPanelBounds: Bounds | null
  overlayBarBounds: Bounds | null
}

/** A rectangle on the screen, in pixels. */
export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

/** The side panel (plan, events) or the horizontal Sanctum bar. */
export type OverlayLayout = 'panel' | 'bar'

export interface OverlayState {
  layout: OverlayLayout
  visible: boolean
  /** True while the player is moving and resizing the overlay. */
  editing: boolean
  bounds: Bounds
}

export interface CharacterState {
  name: string
  class: string
  level: number
}

export interface AreaState {
  name: string
  areaId: string | null
  level: number | null
  seed: string | null
  enteredAt: number
}

export interface SessionState {
  log: {
    path: string
    found: boolean
    /** File size in bytes, null while unknown. */
    size: number | null
    /** When the game last wrote to the file (epoch ms), null while unknown. */
    modifiedAt: number | null
    /** Lines read since the app started following this file. */
    liveLines: number
    /** When the last new line arrived (epoch ms), null if none did yet. */
    lastLineAt: number | null
  }
  hotkey: {
    accelerator: string
    /** False when the OS refused the shortcut (taken by another app or invalid). */
    registered: boolean
  }
  overlay: OverlayState
  startedAt: number
  character: CharacterState | null
  area: AreaState | null
  afk: boolean
  /** Deaths seen live since the app started. */
  deaths: number
  /** Areas entered live since the app started. */
  areasEntered: number
  /** Newest last. Capped. */
  feed: FeedEntry[]
  /** System messages no parser rule matched, newest last. Capped. */
  unknown: FeedEntry[]
}

/** Bridge exposed to the renderer as `window.poe`. */
export interface PoeApi {
  getState(): Promise<SessionState>
  onState(listener: (state: SessionState) => void): () => void
  getConfig(): Promise<AppConfig>
  setConfig(patch: Partial<AppConfig>): Promise<AppConfig>
  /** Opens a file dialog; resolves to the chosen path or null if cancelled. */
  pickLogFile(): Promise<string | null>
  /** Switches back to automatic detection of Client.txt and returns the resulting config. */
  detectLog(): Promise<AppConfig>
  toggleOverlay(): Promise<void>
  /** Starts moving and resizing the given overlay layout, or ends it with null. */
  editOverlay(layout: OverlayLayout | null): Promise<void>
  /** Moves and resizes the overlay being edited. */
  setOverlayBounds(bounds: Bounds): Promise<void>
  /** Puts the layout back to its default place and size. */
  resetOverlay(layout: OverlayLayout): Promise<void>
  /** Puts text on the clipboard: the overlay never has the focus the browser way needs. */
  copyText(text: string): Promise<void>
  plan: PlanApi
  sanctum: SanctumApi
  filter: FilterApi
  update: UpdateApi
}

export const IPC = {
  getState: 'session:get',
  state: 'session:state',
  getConfig: 'config:get',
  setConfig: 'config:set',
  pickLogFile: 'config:pick-log',
  detectLog: 'config:detect-log',
  toggleOverlay: 'overlay:toggle',
  editOverlay: 'overlay:edit',
  setOverlayBounds: 'overlay:set-bounds',
  resetOverlay: 'overlay:reset',
  copyText: 'app:copy-text'
} as const
