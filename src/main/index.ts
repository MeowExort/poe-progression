import { appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from 'electron'
import { IPC, type AppConfig, type SessionState } from '@shared/api'
import { PLAN_IPC, type Answers, type PlanView, type RouteOptions } from '@shared/plan'
import type { LogEvent } from '@shared/events'
import { SANCTUM_IPC, type SanctumAccess } from '@shared/sanctum'
import { detectLogPath, loadConfig, saveConfig } from './config'
import { parseLine } from './log/parser'
import { LogTailer } from './log/tailer'
import { Overlay } from './overlay'
import { PlanStore } from './plan'
import { PoeSite } from './poe-site'
import { PriceBook } from './prices'
import { SanctumService } from './sanctum'
import { SecretStore } from './secrets'
import { Session } from './session'

const preload = join(__dirname, '../preload/index.js')

// Keep one data folder whether the app runs from source or as a packaged exe
// (the packaged app would otherwise be named after its product name).
app.setName('poe-progression')

let config: AppConfig
let configFile: string
let historyFile: string
let mainWindow: BrowserWindow | null = null
let overlay: Overlay | null = null
let tailer: LogTailer | null = null
let plan: PlanStore | null = null
let sanctum: SanctumService | null = null

const session = new Session({
  onChange: broadcast,
  onRecord: (entry) => {
    void appendFile(historyFile, JSON.stringify(entry) + '\n').catch(() => {})
  }
})

function send(channel: string, payload: unknown): void {
  for (const contents of [mainWindow?.webContents, overlay?.webContents]) {
    if (contents && !contents.isDestroyed()) contents.send(channel, payload)
  }
}

function broadcast(state: SessionState): void {
  send(IPC.state, state)
}

function broadcastPlan(view: PlanView): void {
  send(PLAN_IPC.state, view)
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
  session.patch({ log: { path, found: false, size: null, modifiedAt: null, liveLines: 0, lastLineAt: null } })
  if (!path) return

  const current = new LogTailer(path)
  const patchLog = (patch: Partial<SessionState['log']>): void =>
    session.patch({ log: { ...session.getState().log, ...patch } })
  current.on('found', (found) => patchLog({ found }))
  current.on('stats', (stats) => patchLog(stats))
  current.on('backfill', (lines) => session.apply(parseLines(lines), false))
  current.on('lines', (lines) => {
    patchLog({ lastLineAt: Date.now() })
    const events = parseLines(lines)
    session.apply(events, true)
    for (const event of events) {
      if (event.type === 'area_generated') {
        plan?.enterArea(event.areaId)
        sanctum?.onArea(event.ts, event.areaId, event.seed)
      } else if (event.type === 'dialogue') {
        sanctum?.onDialogue(event.ts, event.speaker, event.text)
      }
    }
  })
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
    const logPath = typeof patch.logPath === 'string' ? patch.logPath.trim() : config.logPath
    const logChanged = logPath !== config.logPath
    const next: AppConfig = {
      logPath,
      // A path the user typed or picked stays put; only "detect" switches back to automatic.
      logPathAuto: logChanged ? false : config.logPathAuto,
      overlayHotkey: typeof patch.overlayHotkey === 'string' ? patch.overlayHotkey.trim() : config.overlayHotkey
    }
    const hotkeyChanged = next.overlayHotkey !== config.overlayHotkey
    config = next
    saveConfig(configFile, config)
    if (logChanged) followLog(config.logPath)
    if (hotkeyChanged) applyHotkey()
    return config
  })
  ipcMain.handle(IPC.detectLog, () => {
    const detected = detectLogPath()
    const logPath = detected ?? config.logPath
    const logChanged = logPath !== config.logPath
    config = { ...config, logPath, logPathAuto: true }
    saveConfig(configFile, config)
    if (logChanged) followLog(config.logPath)
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

  ipcMain.handle(PLAN_IPC.get, () => plan?.view())
  ipcMain.handle(PLAN_IPC.setAnswers, (_event, answers: Answers | null) => plan?.setAnswers(answers))
  ipcMain.handle(PLAN_IPC.chooseBuild, (_event, buildId: string | null) => plan?.chooseBuild(buildId))
  ipcMain.handle(PLAN_IPC.importPob, (_event, code: string) =>
    typeof code === 'string' ? (plan?.importPob(code) ?? null) : 'Пустой код.'
  )
  ipcMain.handle(PLAN_IPC.clearPob, () => plan?.clearPob())
  ipcMain.handle(PLAN_IPC.setPobSets, (_event, indexes: number[]) => plan?.setPobSets(Array.isArray(indexes) ? indexes : []))
  ipcMain.handle(PLAN_IPC.setOptions, (_event, patch: Partial<RouteOptions>) => plan?.setOptions(patch ?? {}))
  ipcMain.handle(PLAN_IPC.setPosition, (_event, position: number) => plan?.setPosition(position))
  ipcMain.handle(PLAN_IPC.moveGroup, (_event, delta: number) => plan?.moveGroup(delta))

  ipcMain.handle(SANCTUM_IPC.get, () => sanctum?.view())
  ipcMain.handle(SANCTUM_IPC.saveAccess, (_event, access: SanctumAccess) => sanctum?.saveAccess(access ?? {}))
  ipcMain.handle(SANCTUM_IPC.clearCookie, () => sanctum?.clearCookie())
  ipcMain.handle(SANCTUM_IPC.snapshot, () => sanctum?.snapshot())
  ipcMain.handle(SANCTUM_IPC.newSession, () => sanctum?.newSession())
  ipcMain.handle(SANCTUM_IPC.failActive, () => sanctum?.failActive())
  ipcMain.handle(SANCTUM_IPC.dumpSiteAnswer, async () => {
    const file = await sanctum?.dumpSiteAnswer()
    if (file) shell.showItemInFolder(file)
    return file ?? null
  })
  ipcMain.handle(SANCTUM_IPC.setOutcome, (_event, runId: number, outcome: 'completed' | 'failed') => {
    if (outcome === 'completed' || outcome === 'failed') sanctum?.setOutcome(runId, outcome)
  })
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
    if (config.logPathAuto) {
      const detected = detectLogPath()
      if (detected && detected !== config.logPath) {
        config = { ...config, logPath: detected }
        saveConfig(configFile, config)
      }
    }

    plan = new PlanStore(join(userData, 'plan.json'), broadcastPlan)
    sanctum = new SanctumService({
      file: join(userData, 'account.json'),
      runsFile: join(userData, 'sanctum-runs.json'),
      debugDir: join(userData, 'debug'),
      site: new PoeSite(),
      secrets: new SecretStore(join(userData, 'secrets.json'), safeStorage),
      prices: new PriceBook(join(userData, 'prices.json')),
      onChange: (view) => send(SANCTUM_IPC.state, view)
    })

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
