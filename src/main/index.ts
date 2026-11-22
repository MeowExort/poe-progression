import { appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { IPC, type AppConfig, type SessionState } from '@shared/api'
import type { LogEvent } from '@shared/events'
import { detectLogPath, loadConfig, saveConfig } from './config'
import { parseLine } from './log/parser'
import { LogTailer } from './log/tailer'
import { Overlay } from './overlay'
import { Session } from './session'

const preload = join(__dirname, '../preload/index.js')

let config: AppConfig
let configFile: string
let historyFile: string
let mainWindow: BrowserWindow | null = null
let overlay: Overlay | null = null
let tailer: LogTailer | null = null

const session = new Session({
  onChange: broadcast,
  onRecord: (entry) => {
    void appendFile(historyFile, JSON.stringify(entry) + '\n').catch(() => {})
  }
})

function broadcast(state: SessionState): void {
  for (const contents of [mainWindow?.webContents, overlay?.webContents]) {
    if (contents && !contents.isDestroyed()) contents.send(IPC.state, state)
  }
}

/** Loads the renderer in the given view: the dev server while developing, the built files otherwise. */
function loadView(window: BrowserWindow, view: 'main' | 'overlay'): void {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && devUrl) {
    void window.loadURL(`${devUrl}?view=${view}`)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'), { query: { view } })
  }
}

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 720,
    minHeight: 480,
    show: false,
    backgroundColor: '#14110e',
    autoHideMenuBar: true,
    title: 'PoE Progression',
    webPreferences: { preload }
  })
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => {
    mainWindow = null
    app.quit()
  })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  loadView(mainWindow, 'main')
}

function parseLines(lines: string[]): LogEvent[] {
  const events: LogEvent[] = []
  for (const line of lines) {
    const result = parseLine(line)
    if (result.kind === 'event') events.push(result.event)
  }
  return events
}

function followLog(path: string): void {
  tailer?.stop()
  tailer = null
  session.reset()
  session.patch({ log: { path, found: false, lastLineAt: null } })
  if (!path) return

  const current = new LogTailer(path)
  current.on('found', (found) => session.patch({ log: { ...session.getState().log, found } }))
  current.on('backfill', (lines) => session.apply(parseLines(lines), false))
  current.on('lines', (lines) => session.apply(parseLines(lines), true))
  current.start()
  tailer = current
}

function applyHotkey(): void {
  const registered = overlay?.setHotkey(config.overlayHotkey) ?? false
  session.patch({ hotkey: { accelerator: config.overlayHotkey, registered } })
}

function registerIpc(): void {
  ipcMain.handle(IPC.getState, () => session.getState())
  ipcMain.handle(IPC.getConfig, () => config)
  ipcMain.handle(IPC.setConfig, (_event, patch: Partial<AppConfig>) => {
    const next: AppConfig = {
      logPath: typeof patch.logPath === 'string' ? patch.logPath.trim() : config.logPath,
      overlayHotkey: typeof patch.overlayHotkey === 'string' ? patch.overlayHotkey.trim() : config.overlayHotkey
    }
    const logChanged = next.logPath !== config.logPath
    const hotkeyChanged = next.overlayHotkey !== config.overlayHotkey
    config = next
    saveConfig(configFile, config)
    if (logChanged) followLog(config.logPath)
    if (hotkeyChanged) applyHotkey()
    return config
  })
  ipcMain.handle(IPC.pickLogFile, async () => {
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Client.txt',
      defaultPath: config.logPath || undefined,
      properties: ['openFile'],
      filters: [{ name: 'Client.txt', extensions: ['txt'] }]
    })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
  ipcMain.handle(IPC.toggleOverlay, () => overlay?.toggle())
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  void app.whenReady().then(async () => {
    const userData = app.getPath('userData')
    configFile = join(userData, 'config.json')
    historyFile = join(userData, 'history', 'events.jsonl')
    await mkdir(join(userData, 'history'), { recursive: true })

    config = loadConfig(configFile)
    if (!config.logPath) {
      const detected = detectLogPath()
      if (detected) {
        config = { ...config, logPath: detected }
        saveConfig(configFile, config)
      }
    }

    registerIpc()
    createMainWindow()
    overlay = new Overlay({
      preload,
      load: (window) => loadView(window, 'overlay'),
      onVisibility: (overlayVisible) => session.patch({ overlayVisible })
    })
    overlay.create()
    applyHotkey()
    followLog(config.logPath)
  })

  app.on('will-quit', () => {
    tailer?.stop()
    overlay?.destroy()
  })
}
