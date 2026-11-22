import type { FeedEntry } from './events'

export interface AppConfig {
  /** Absolute path to Client.txt. Empty until detected or chosen. */
  logPath: string
  /** Electron accelerator, e.g. "Shift+F". */
  overlayHotkey: string
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
    /** Epoch ms of the last line read from the log, null if nothing was read yet. */
    lastLineAt: number | null
  }
  hotkey: {
    accelerator: string
    /** False when the OS refused the shortcut (taken by another app or invalid). */
    registered: boolean
  }
  overlayVisible: boolean
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
  toggleOverlay(): Promise<void>
}

export const IPC = {
  getState: 'session:get',
  state: 'session:state',
  getConfig: 'config:get',
  setConfig: 'config:set',
  pickLogFile: 'config:pick-log',
  toggleOverlay: 'overlay:toggle'
} as const
