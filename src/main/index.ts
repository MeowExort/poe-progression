import { readFileSync, writeFileSync } from 'node:fs'
import { appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { app, BrowserWindow, clipboard, dialog, ipcMain, safeStorage, session as electronSession, shell } from 'electron'
import { IPC, type AppConfig, type Bounds, type OverlayLayout, type SessionState } from '@shared/api'
import { FILTER_IPC } from '@shared/filter'
import { PLAN_IPC, type Answers, type PlanView, type RouteOptions } from '@shared/plan'
import type { LogEvent } from '@shared/events'
import { SANCTUM_IPC, type SanctumAccess } from '@shared/sanctum'
import { UPDATE_IPC } from '@shared/update'
import { autoUpdater } from 'electron-updater'
import { AREAS } from '@core/route/data'
import { detectLogPath, loadConfig, readBounds, saveConfig } from './config'
import { FilterWriter } from './filter'
import { parseLine } from './log/parser'
import { LogTailer } from './log/tailer'
import { Overlay } from './overlay'
import { PlanStore } from './plan'
import { PoeSite } from './poe-site'
import { PriceBook } from './prices'
import { RelicPricer } from './relic-pricer'
import { SanctumService } from './sanctum'
import { SecretStore } from './secrets'
import { Session } from './session'
import { TradeClient } from './trade'
import { Updater } from './updater'

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
let boundsSaveTimer: NodeJS.Timeout | null = null
let updater: Updater | null = null
/** Updates are looked for shortly after startup and then every few hours. */
const UPDATE_FIRST_CHECK_MS = 15_000
const UPDATE_INTERVAL_MS = 4 * 60 * 60 * 1000
/** Where reading of the game log stopped, saved so the next launch can pick up from there. */
let positionFile: string
let positionSavedAt = 0

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
  scheduleFilterRefresh()
}

let filter: FilterWriter | null = null
let filterTimer: NodeJS.Timeout | null = null

/** The plan reports every step taken; the filter only depends on the build, so it can wait a moment. */
function scheduleFilterRefresh(): void {
  if (filterTimer) clearTimeout(filterTimer)
  filterTimer = setTimeout(() => filter?.refresh(), 1500)
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

function savedLogPosition(path: string): number | undefined {
  try {
    const saved = JSON.parse(readFileSync(positionFile, 'utf8')) as { path?: unknown; position?: unknown }
    return saved.path === path && typeof saved.position === 'number' ? saved.position : undefined
  } catch {
    return undefined
  }
}

function saveLogPosition(): void {
  if (!tailer) return
  positionSavedAt = Date.now()
  try {
    writeFileSync(positionFile, JSON.stringify({ path: tailer.path, position: tailer.processedPosition }))
  } catch {
    // Without it the next launch simply starts from the end of the log.
  }
}

function followLog(path: string): void {
  tailer?.stop()
  tailer = null
  session.reset()
  session.patch({ log: { path, found: false, size: null, modifiedAt: null, liveLines: 0, lastLineAt: null } })
  if (!path) return

  // The tail is read generously: it is also how a run already under way is recognised when
  // the app starts with no saved position to continue from.
  const current = new LogTailer(path, { resumeFrom: savedLogPosition(path), backfillBytes: 2 * 1024 * 1024 })
  let tail: LogEvent[] = []
  const patchLog = (patch: Partial<SessionState['log']>): void =>
    session.patch({ log: { ...session.getState().log, ...patch } })
  current.on('found', (found) => patchLog({ found }))
  current.on('stats', (stats) => patchLog(stats))
  current.on('backfill', (lines) => {
    tail = parseLines(lines)
    session.apply(tail, false)
  })
  current.on('resume', (lines) => {
    // What the game wrote while the app was closed: the plan and an interrupted Sanctum run
    // catch up on it, so a restart mid-run loses nothing.
    const events = lines ? parseLines(lines) : null
    for (const event of events ?? []) {
      if (event.type === 'area_generated') plan?.enterArea(event.areaId)
    }
    sanctum?.resume(events, tail)
    tail = []
    saveLogPosition()
  })
  current.on('lines', (lines) => {
    patchLog({ lastLineAt: Date.now() })
    const events = parseLines(lines)
    session.apply(events, true)
    let tracked = false
    for (const event of events) {
      if (event.type === 'area_generated') {
        plan?.enterArea(event.areaId)
        sanctum?.onArea(event.ts, event.areaId, event.seed)
        tracked = true
        // Points are usually spent in town: a good moment to look at the tree again.
        if (AREAS[event.areaId]?.is_town_area) scheduleTreeRead()
      } else if (event.type === 'level_up') {
        const character = session.getState().character
        if (character) plan?.setLevel(character.level)
        scheduleTreeRead()
      } else if (event.type === 'dialogue') {
        sanctum?.onDialogue(event.ts, event.speaker, event.text)
        tracked = true
      }
    }
    // The position is saved together with what the trackers just learned, and otherwise now
    // and then: after a crash the next launch re-reads at most a couple of seconds of log.
    if (tracked || Date.now() - positionSavedAt > 2000) saveLogPosition()
  })
  tailer = current
  current.start()
}

/** The character's passive tree is read again at most this often, unless the player asks. */
const TREE_READ_GAP_MS = 60_000
/** The site learns of a level-up or a spent point a moment after the game does. */
const TREE_READ_DELAY_MS = 4000
let treeReadAt = 0
let treeReadTimer: NodeJS.Timeout | null = null

/** Reads the character's passive tree from the site and hands it to the plan. */
async function readTree(force: boolean): Promise<void> {
  if (!plan?.followsTree || !sanctum) return
  if (!force && Date.now() - treeReadAt < TREE_READ_GAP_MS) return
  treeReadAt = Date.now()
  plan.setTreeReading({ busy: true, error: null })
  const result = await sanctum.readPassives(session.getState().character?.name ?? null)
  if ('error' in result) plan.setTreeReading({ busy: false, error: result.error })
  else plan.setAllocated(result.character, result.hashes, Date.now())
}

function scheduleTreeRead(): void {
  if (treeReadTimer) clearTimeout(treeReadTimer)
  treeReadTimer = setTimeout(() => void readTree(false), TREE_READ_DELAY_MS)
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
      ...config,
      logPath,
      // A path the user typed or picked stays put; only "detect" switches back to automatic.
      logPathAuto: logChanged ? false : config.logPathAuto,
      overlayHotkey: typeof patch.overlayHotkey === 'string' ? patch.overlayHotkey.trim() : config.overlayHotkey,
      overlayPanelEnabled:
        typeof patch.overlayPanelEnabled === 'boolean' ? patch.overlayPanelEnabled : config.overlayPanelEnabled
    }
    const hotkeyChanged = next.overlayHotkey !== config.overlayHotkey
    config = next
    saveConfig(configFile, config)
    if (logChanged) followLog(config.logPath)
    if (hotkeyChanged) applyHotkey()
    overlay?.refresh()
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
  ipcMain.handle(IPC.editOverlay, (_event, layout: OverlayLayout | null) =>
    overlay?.edit(layout === 'panel' || layout === 'bar' ? layout : null)
  )
  ipcMain.handle(IPC.setOverlayBounds, (_event, bounds: Bounds) => {
    const clean = readBounds(bounds)
    if (clean) overlay?.setBounds(clean)
  })
  ipcMain.handle(IPC.resetOverlay, (_event, layout: OverlayLayout) => {
    if (layout === 'panel' || layout === 'bar') overlay?.reset(layout)
  })

  ipcMain.handle(PLAN_IPC.get, () => plan?.view())
  ipcMain.handle(PLAN_IPC.setAnswers, (_event, answers: Answers | null) => plan?.setAnswers(answers))
  ipcMain.handle(PLAN_IPC.chooseBuild, (_event, buildId: string | null) => plan?.chooseBuild(buildId))
  ipcMain.handle(PLAN_IPC.importPob, (_event, code: string) => {
    if (typeof code !== 'string') return 'Пустой код.'
    const problem = plan?.importPob(code) ?? null
    if (!problem) void readTree(true)
    return problem
  })
  ipcMain.handle(PLAN_IPC.clearPob, () => plan?.clearPob())
  ipcMain.handle(PLAN_IPC.setPobSets, (_event, indexes: number[]) => plan?.setPobSets(Array.isArray(indexes) ? indexes : []))
  ipcMain.handle(PLAN_IPC.setOptions, (_event, patch: Partial<RouteOptions>) => plan?.setOptions(patch ?? {}))
  ipcMain.handle(PLAN_IPC.setPosition, (_event, position: number) => plan?.setPosition(position))
  ipcMain.handle(PLAN_IPC.moveGroup, (_event, delta: number) => plan?.moveGroup(delta))

  ipcMain.handle(IPC.copyText, (_event, text: string) => {
    if (typeof text === 'string') clipboard.writeText(text.slice(0, 2000))
  })
  ipcMain.handle(PLAN_IPC.refreshTree, () => readTree(true))
  ipcMain.handle(PLAN_IPC.setTreeTarget, (_event, index: number | null) => plan?.setTreeTarget(index))

  ipcMain.handle(FILTER_IPC.get, () => filter?.view())
  ipcMain.handle(FILTER_IPC.setOptions, (_event, patch: { enabled?: boolean; usePrices?: boolean; useBuildNames?: boolean; dir?: string | null }) =>
    filter?.setOptions(patch ?? {})
  )
  ipcMain.handle(FILTER_IPC.openFolder, () => {
    if (filter) void shell.openPath(filter.dir)
  })

  ipcMain.handle(UPDATE_IPC.get, () => updater?.view())
  ipcMain.handle(UPDATE_IPC.check, () => updater?.check())
  ipcMain.handle(UPDATE_IPC.install, () => updater?.install())
  ipcMain.handle(UPDATE_IPC.dismissWhatsNew, () => updater?.dismissWhatsNew())

  ipcMain.handle(SANCTUM_IPC.get, () => sanctum?.view())
  ipcMain.handle(SANCTUM_IPC.saveAccess, (_event, access: SanctumAccess) => sanctum?.saveAccess(access ?? {}))
  ipcMain.handle(SANCTUM_IPC.clearCookie, () => sanctum?.clearCookie())
  ipcMain.handle(SANCTUM_IPC.snapshot, () => sanctum?.snapshot())
  ipcMain.handle(SANCTUM_IPC.setTracked, (_event, names: string[], trackAll: boolean) =>
    sanctum?.setTracked(Array.isArray(names) ? names : [], trackAll)
  )
  ipcMain.handle(SANCTUM_IPC.getCatalog, () => sanctum?.getCatalog() ?? [])
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
  ipcMain.handle(SANCTUM_IPC.deleteRun, (_event, runId: number) => {
    if (typeof runId === 'number') sanctum?.deleteRun(runId)
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
    positionFile = join(userData, 'log-position.json')
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
    const secrets = new SecretStore(join(userData, 'secrets.json'), safeStorage)
    const prices = new PriceBook(join(userData, 'prices.json'))
    // The trade site only answers a browser. Its requests go through Chromium's own network
    // stack in a separate in-memory session, which holds nothing but the player's site cookie.
    const tradeSession = electronSession.fromPartition('poe-trade')
    const trade = new TradeClient(async (url, init) => {
      const cookie = secrets.get('poesessid')
      if (cookie) {
        await tradeSession.cookies.set({
          url: 'https://www.pathofexile.com',
          name: 'POESESSID',
          value: cookie,
          secure: true,
          httpOnly: true
        })
      }
      return tradeSession.fetch(url, init)
    })
    sanctum = new SanctumService({
      file: join(userData, 'account.json'),
      runsFile: join(userData, 'sanctum-runs.json'),
      stateFile: join(userData, 'sanctum-state.json'),
      debugDir: join(userData, 'debug'),
      site: new PoeSite(),
      secrets,
      prices,
      relics: new RelicPricer(trade, prices),
      onChange: (view) => {
        send(SANCTUM_IPC.state, view)
        // The bar replaces the side panel for as long as a run is on screen.
        overlay?.setInRun(view.active !== null || view.finished !== null)
      }
    })

    filter = new FilterWriter({
      file: join(userData, 'filter.json'),
      defaultDir: join(app.getPath('documents'), 'My Games', 'Path of Exile'),
      input: () => {
        const league = sanctum?.currentLeague ?? null
        const book = league ? prices.peek(league) : null
        return {
          ...plan!.filterInput(),
          prices: book ? { chaosByName: book.chaosByName, divineChaos: book.divineChaos } : null
        }
      },
      onChange: (view) => send(FILTER_IPC.state, view)
    })
    filter.refresh()
    // Prices older than the cache allows are fetched again; the filter follows once they arrive.
    const league = sanctum.currentLeague
    if (league) void prices.get(league).then(() => filter?.refresh(), () => {})

    // Only an installed copy can update itself; running from source has nothing to replace.
    updater = new Updater({
      current: app.getVersion(),
      enabled: app.isPackaged,
      source: app.isPackaged ? autoUpdater : null,
      file: join(userData, 'update.json'),
      onChange: (state) => send(UPDATE_IPC.state, state)
    })
    setTimeout(() => void updater?.check(), UPDATE_FIRST_CHECK_MS)
    setInterval(() => void updater?.check(), UPDATE_INTERVAL_MS)

    registerIpc()
    createMainWindow()
    overlay = new Overlay({
      preload,
      load: (window) => loadView(window, 'overlay'),
      onState: (state) => session.patch({ overlay: state }),
      storedBounds: (layout) => (layout === 'panel' ? config.overlayPanelBounds : config.overlayBarBounds),
      saveBounds: (layout, bounds) => {
        config = layout === 'panel' ? { ...config, overlayPanelBounds: bounds } : { ...config, overlayBarBounds: bounds }
        // Dragging reports dozens of positions a second: write the file once it settles.
        if (boundsSaveTimer) clearTimeout(boundsSaveTimer)
        boundsSaveTimer = setTimeout(() => saveConfig(configFile, config), 300)
      },
      panelEnabled: () => config.overlayPanelEnabled
    })
    overlay.create()
    applyHotkey()
    followLog(config.logPath)
    // Once the end of the log is read the character is known: look at its tree.
    setTimeout(() => {
      const character = session.getState().character
      if (character) plan?.setLevel(character.level)
      void readTree(true)
    }, TREE_READ_DELAY_MS)
  })

  app.on('will-quit', () => {
    saveLogPosition()
    tailer?.stop()
    overlay?.destroy()
  })
}
