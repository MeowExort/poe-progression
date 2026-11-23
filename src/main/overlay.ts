import { BrowserWindow, globalShortcut, screen } from 'electron'
import type { Bounds, OverlayLayout, OverlayState } from '@shared/api'

export interface OverlayOptions {
  preload: string
  load: (window: BrowserWindow) => void
  onState: (state: OverlayState) => void
  /** Where the player put a layout, or null for the default place. */
  storedBounds: (layout: OverlayLayout) => Bounds | null
  saveBounds: (layout: OverlayLayout, bounds: Bounds | null) => void
  /** False when the player wants no side panel, only the Sanctum bar. */
  panelEnabled: () => boolean
}

/** Ignore hotkey presses that follow each other faster than this: a held key auto-repeats. */
const TOGGLE_DEBOUNCE_MS = 250
const MIN_SIZE: Record<OverlayLayout, { width: number; height: number }> = {
  panel: { width: 240, height: 180 },
  bar: { width: 480, height: 44 }
}

/** The default place of each layout on the primary display. */
export function defaultBounds(layout: OverlayLayout, display: { bounds: Bounds; workArea: Bounds }): Bounds {
  if (layout === 'panel') {
    const { workArea } = display
    return {
      x: workArea.x + 8,
      y: workArea.y + Math.round(workArea.height * 0.14),
      width: 360,
      height: Math.round(workArea.height * 0.5)
    }
  }
  // The bar spans the screen just above the game's experience bar. The game covers the taskbar
  // in windowed fullscreen, so this is measured from the full screen, not the work area.
  const { bounds } = display
  const height = Math.round(bounds.height * 0.081)
  return {
    x: bounds.x,
    y: bounds.y + bounds.height - height - Math.round(bounds.height * 0.012),
    width: bounds.width,
    height
  }
}

/**
 * A frameless, transparent, always-on-top window over the game, in one of two layouts:
 * the side panel, or the horizontal Sanctum bar while a run is on. Each layout has its own
 * place, size and shown/hidden state; the hotkey toggles whichever is current.
 *
 * The window is not focusable, so it never takes keyboard focus from the game, and the bar
 * lets mouse clicks through to the game beneath it. The game must run in "Windowed
 * Fullscreen": nothing can be drawn over exclusive fullscreen.
 *
 * The window is shown once and stays shown. "Hiding" makes it fully transparent and
 * click-through instead of calling hide(): a real hide/show cycle makes Windows replay its
 * window animation and makes Chromium pause and then catch up on painting, which looks like lag.
 */
export class Overlay {
  private window: BrowserWindow | null = null
  private accelerator: string | null = null
  private readonly shown: Record<OverlayLayout, boolean> = { panel: false, bar: false }
  private inRun = false
  private editing: OverlayLayout | null = null
  private lastToggle = 0
  /** Opacity is not supported on Linux; there the window is really hidden and shown. */
  private readonly fade = process.platform !== 'linux'

  constructor(private readonly options: OverlayOptions) {}

  create(): void {
    const window = new BrowserWindow({
      ...this.bounds('panel'),
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
      // Keep painting while invisible, so the overlay is up to date the moment it appears.
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
    this.apply()
  }

  /** The hotkey: shows or hides the layout that is current. */
  toggle(): void {
    const now = Date.now()
    if (now - this.lastToggle < TOGGLE_DEBOUNCE_MS || this.editing) return
    this.lastToggle = now
    const layout = this.layout()
    if (layout === 'panel' && !this.options.panelEnabled()) return
    this.shown[layout] = !this.shown[layout]
    this.apply()
  }

  /** Call when a Sanctum run starts or stops being on screen: the bar replaces the panel meanwhile. */
  setInRun(inRun: boolean): void {
    if (inRun === this.inRun) return
    this.inRun = inRun
    // The bar comes up by itself at the start of a run; the hotkey can still hide it.
    if (inRun) this.shown.bar = true
    this.apply()
  }

  /** Starts moving and resizing a layout, or ends it with null. */
  edit(layout: OverlayLayout | null): void {
    this.editing = layout
    this.apply()
  }

  /** Moves and resizes the layout being edited. */
  setBounds(bounds: Bounds): void {
    if (!this.editing) return
    const min = MIN_SIZE[this.editing]
    this.options.saveBounds(this.editing, {
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.max(min.width, Math.round(bounds.width)),
      height: Math.max(min.height, Math.round(bounds.height))
    })
    this.apply()
  }

  reset(layout: OverlayLayout): void {
    this.options.saveBounds(layout, null)
    this.apply()
  }

  /** Re-reads the settings (panel enabled, stored places) and updates the window. */
  refresh(): void {
    this.apply()
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

  // ── internals ──

  private layout(): OverlayLayout {
    return this.editing ?? (this.inRun ? 'bar' : 'panel')
  }

  private visible(): boolean {
    if (this.editing) return true
    const layout = this.layout()
    return this.shown[layout] && (layout === 'bar' || this.options.panelEnabled())
  }

  private bounds(layout: OverlayLayout): Bounds {
    return this.options.storedBounds(layout) ?? defaultBounds(layout, screen.getPrimaryDisplay())
  }

  /** Brings the window in line with the current layout, place and visibility. */
  private apply(): void {
    const window = this.window
    if (!window) return
    const layout = this.layout()
    const visible = this.visible()
    const bounds = this.bounds(layout)

    const current = window.getBounds()
    if (current.x !== bounds.x || current.y !== bounds.y || current.width !== bounds.width || current.height !== bounds.height) {
      window.setBounds(bounds)
    }
    if (this.fade) {
      window.setOpacity(visible ? 1 : 0)
      // The bar sits over the game's own controls, so clicks go through it — except while editing.
      window.setIgnoreMouseEvents(!visible || (layout === 'bar' && !this.editing))
      if (visible) window.setAlwaysOnTop(true, 'screen-saver')
    } else if (visible) {
      window.showInactive()
    } else {
      window.hide()
    }
    this.options.onState({ layout, visible, editing: this.editing !== null, bounds })
  }
}
