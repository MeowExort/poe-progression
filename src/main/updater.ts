import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { UpdateState } from '@shared/update'

/** The part of electron-updater's `autoUpdater` this uses. */
export interface UpdateSource {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  on(event: string, listener: (...args: any[]) => void): unknown
  checkForUpdates(): Promise<unknown>
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
}

export interface UpdaterOptions {
  /** The version that is running. */
  current: string
  /** False when running from source: there is nothing to update then. */
  enabled: boolean
  source: UpdateSource | null
  /** Remembers the notes of a downloaded update, to show them after it is installed. */
  file: string | null
  onChange?: (state: UpdateState) => void
  now?: () => number
}

/**
 * Release notes as plain lines. The notes arrive as the HTML GitHub renders from the
 * changelog; headings and list items become lines, list items get a bullet.
 */
export function notesToLines(notes: unknown): string[] {
  const html = Array.isArray(notes)
    ? notes.map((entry) => (typeof entry?.note === 'string' ? entry.note : '')).join('\n')
    : typeof notes === 'string'
      ? notes
      : ''
  return html
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<\/(p|div|h[1-6]|li|ul|ol)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .split('\n')
    .map((line) => line.replace(/^[-*]\s+/, '• ').replace(/\s+/g, ' ').trim())
    .filter((line) => line && line !== '•')
}

/**
 * Keeps the app up to date from the project's GitHub releases: checks, downloads in the
 * background, and installs when the player says so or when the app is next closed.
 */
export class Updater {
  private state: UpdateState
  private readonly now: () => number

  constructor(private readonly options: UpdaterOptions) {
    this.now = options.now ?? Date.now
    const stored = this.readStored()
    this.state = {
      current: options.current,
      status: options.enabled && options.source ? 'idle' : 'disabled',
      version: null,
      notes: [],
      progress: null,
      error: null,
      checkedAt: null,
      // The notes saved before the update are for the version that is running now.
      whatsNew: stored?.version === options.current ? stored : null
    }

    const source = options.source
    if (!options.enabled || !source) return
    source.autoDownload = true
    // Even without a click, the downloaded version goes in when the app is closed.
    source.autoInstallOnAppQuit = true
    source.on('checking-for-update', () => this.set({ status: this.state.status === 'ready' ? 'ready' : 'checking', error: null }))
    source.on('update-not-available', () => {
      if (this.state.status !== 'ready') this.set({ status: 'idle', checkedAt: this.now() })
    })
    source.on('update-available', (info: { version?: string; releaseNotes?: unknown }) => {
      if (this.state.status === 'ready' && this.state.version === info.version) return
      this.set({
        status: 'downloading',
        version: info.version ?? null,
        notes: notesToLines(info.releaseNotes),
        progress: 0,
        checkedAt: this.now()
      })
    })
    source.on('download-progress', (progress: { percent?: number }) => {
      if (this.state.status === 'downloading') this.set({ progress: Math.round(progress.percent ?? 0) })
    })
    source.on('update-downloaded', (info: { version?: string; releaseNotes?: unknown }) => {
      const version = info.version ?? this.state.version
      const notes = this.state.notes.length ? this.state.notes : notesToLines(info.releaseNotes)
      if (version) this.writeStored({ version, notes })
      this.set({ status: 'ready', version: version ?? null, notes, progress: 100 })
    })
    source.on('error', (error: unknown) => {
      // A failed check must not hide an update that is already downloaded.
      if (this.state.status === 'ready') return
      this.set({ status: 'error', error: describe(error), checkedAt: this.now() })
    })
  }

  view(): UpdateState {
    return this.state
  }

  async check(): Promise<void> {
    const source = this.options.source
    if (this.state.status === 'disabled' || !source) return
    if (this.state.status === 'checking' || this.state.status === 'downloading') return
    try {
      await source.checkForUpdates()
    } catch (error) {
      if (this.state.status !== 'ready') this.set({ status: 'error', error: describe(error), checkedAt: this.now() })
    }
  }

  install(): void {
    if (this.state.status === 'ready') this.options.source?.quitAndInstall(true, true)
  }

  dismissWhatsNew(): void {
    this.writeStored(null)
    this.set({ whatsNew: null })
  }

  private set(patch: Partial<UpdateState>): void {
    this.state = { ...this.state, ...patch }
    this.options.onChange?.(this.state)
  }

  private readStored(): { version: string; notes: string[] } | null {
    if (!this.options.file) return null
    try {
      const stored = JSON.parse(readFileSync(this.options.file, 'utf8')) as { version?: unknown; notes?: unknown }
      if (typeof stored?.version !== 'string' || !Array.isArray(stored.notes)) return null
      return { version: stored.version, notes: stored.notes.filter((line): line is string => typeof line === 'string') }
    } catch {
      return null
    }
  }

  private writeStored(value: { version: string; notes: string[] } | null): void {
    if (!this.options.file) return
    try {
      mkdirSync(dirname(this.options.file), { recursive: true })
      writeFileSync(this.options.file, JSON.stringify(value))
    } catch {
      // Only the "what's new" note after the update depends on this.
    }
  }
}

function describe(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|net::/i.test(message)) {
    return 'Нет связи с GitHub — проверю позже.'
  }
  if (/404|latest\.yml/i.test(message)) return 'На GitHub пока нет опубликованных версий.'
  return `Не удалось проверить обновления: ${message.split('\n')[0].slice(0, 200)}`
}
