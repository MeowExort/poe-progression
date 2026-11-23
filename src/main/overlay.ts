import { BrowserWindow, globalShortcut, screen } from 'electron'

const WIDTH = 360

export interface OverlayOptions {
  preload: string
  load: (window: BrowserWindow) => void
  onVisibility: (visible: boolean) => void
}

/** Ignore hotkey presses that follow each other faster than this: a held key auto-repeats. */
const TOGGLE_DEBOUNCE_MS = 250

/**
 * A frameless, transparent, always-on-top panel shown over the game.
 * It is not focusable, so showing it or clicking it never takes keyboard focus from the game.
 * The game must run in "Windowed Fullscreen": nothing can be drawn over exclusive fullscreen.
 *
 * The window is shown once and stays shown. "Hiding" makes it fully transparent and
 * click-through instead of calling hide(): a real hide/show cycle makes Windows replay its
 * window animation and makes Chromium pause and then catch up on painting, which looks like lag.
 */
export class Overlay {
  private window: BrowserWindow | null = null
  private accelerator: string | null = null
  private visible = false
  private lastToggle = 0
  /** Opacity is not supported on Linux; there the window is really hidden and shown. */
  private readonly fade = process.platform !== 'linux'

  constructor(private readonly options: OverlayOptions) {}

  create(): void {
    const { workArea } = screen.getPrimaryDisplay()
    const window = new BrowserWindow({
      width: WIDTH,
      height: Math.round(workArea.height * 0.5),
      x: workArea.x + 8,
      y: workArea.y + Math.round(workArea.height * 0.14),
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      focusable: false,
      hasShadow: false,
      alwaysOnTop: true,
      // Keep painting while invisible, so the panel is up to date the moment it appears.
      webPreferences: { preload: this.options.preload, backgroundThrottling: false }
    })
    // "screen-saver" is the highest level: stays above a borderless fullscreen game window.
    window.setAlwaysOnTop(true, 'screen-saver')
    if (this.fade) {
      window.setOpacity(0)
      window.setIgnoreMouseEvents(true)
      window.once('ready-to-show', () => window.showInactive())
    }
    window.on('closed', () => {
      this.window = null
    })
    this.options.load(window)
    this.window = window
  }

  toggle(): void {
    const window = this.window
    if (!window) return
    const now = Date.now()
    if (now - this.lastToggle < TOGGLE_DEBOUNCE_MS) return
    this.lastToggle = now

    this.visible = !this.visible
    if (this.fade) {
      window.setOpacity(this.visible ? 1 : 0)
      window.setIgnoreMouseEvents(!this.visible)
      if (this.visible) window.setAlwaysOnTop(true, 'screen-saver')
    } else if (this.visible) {
      window.showInactive()
    } else {
      window.hide()
    }
    this.options.onVisibility(this.visible)
  }

  /** Registers the global toggle hotkey, replacing the previous one. Returns false if the OS refused it. */
  setHotkey(accelerator: string): boolean {
    if (this.accelerator) {
      globalShortcut.unregister(this.accelerator)
      this.accelerator = null
    }
    if (!accelerator) return false
    try {
      if (!globalShortcut.register(accelerator, () => this.toggle())) return false
    } catch {
      // Electron throws on an accelerator string it cannot parse.
      return false
    }
    this.accelerator = accelerator
    return true
  }

  destroy(): void {
    if (this.accelerator) globalShortcut.unregister(this.accelerator)
    this.accelerator = null
    this.window?.destroy()
    this.window = null
  }

  get webContents(): Electron.WebContents | null {
    return this.window?.webContents ?? null
  }
}
