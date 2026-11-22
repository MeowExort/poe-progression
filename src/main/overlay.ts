import { BrowserWindow, globalShortcut, screen } from 'electron'

const WIDTH = 360

export interface OverlayOptions {
  preload: string
  load: (window: BrowserWindow) => void
  onVisibility: (visible: boolean) => void
}

/**
 * A frameless, transparent, always-on-top panel shown over the game.
 * It is not focusable, so showing it or clicking it never takes keyboard focus from the game.
 * The game must run in "Windowed Fullscreen": nothing can be drawn over exclusive fullscreen.
 */
export class Overlay {
  private window: BrowserWindow | null = null
  private accelerator: string | null = null

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
      webPreferences: { preload: this.options.preload }
    })
    // "screen-saver" is the highest level: stays above a borderless fullscreen game window.
    window.setAlwaysOnTop(true, 'screen-saver')
    window.on('show', () => this.options.onVisibility(true))
    window.on('hide', () => this.options.onVisibility(false))
    window.on('closed', () => {
      this.window = null
    })
    this.options.load(window)
    this.window = window
  }

  toggle(): void {
    const window = this.window
    if (!window) return
    if (window.isVisible()) {
      window.hide()
    } else {
      window.showInactive()
      window.setAlwaysOnTop(true, 'screen-saver')
    }
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
