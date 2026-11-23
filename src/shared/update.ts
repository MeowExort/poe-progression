/** What the app knows about updates of itself. */
export interface UpdateState {
  /** The version that is running. */
  current: string
  /**
   * "disabled": updates do not apply (running from source). "idle": nothing newer known.
   * "checking": asking. "downloading": a newer version is on its way. "ready": it is
   * downloaded and will be installed on restart. "error": the last check failed.
   */
  status: 'disabled' | 'idle' | 'checking' | 'downloading' | 'ready' | 'error'
  /** The newer version, while downloading or ready. */
  version: string | null
  /** What changes with that version, one line each. */
  notes: string[]
  /** Download progress, 0 to 100. */
  progress: number | null
  /** Why the last check failed, ready to show. */
  error: string | null
  /** When the last check finished (epoch ms). */
  checkedAt: number | null
  /** Set on the first launch after an update: what changed in the version now running. */
  whatsNew: { version: string; notes: string[] } | null
}

export interface UpdateApi {
  get(): Promise<UpdateState>
  onChange(listener: (state: UpdateState) => void): () => void
  check(): Promise<void>
  /** Restarts the app into the downloaded version. */
  install(): Promise<void>
  /** Closes the "what's new" note. */
  dismissWhatsNew(): Promise<void>
}

export const UPDATE_IPC = {
  get: 'update:get',
  state: 'update:state',
  check: 'update:check',
  install: 'update:install',
  dismissWhatsNew: 'update:dismiss-whats-new'
} as const
