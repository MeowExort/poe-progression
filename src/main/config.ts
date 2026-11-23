import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, win32 } from 'node:path'
import type { AppConfig, Bounds } from '@shared/api'

export const DEFAULT_CONFIG: AppConfig = {
  logPath: '',
  logPathAuto: true,
  overlayHotkey: 'Shift+F',
  overlayPanelEnabled: true,
  overlayPanelBounds: null,
  overlayBarBounds: null
}

export function loadConfig(file: string): AppConfig {
  try {
    const stored = JSON.parse(readFileSync(file, 'utf8')) as Partial<AppConfig>
    return {
      logPath: typeof stored.logPath === 'string' ? stored.logPath : DEFAULT_CONFIG.logPath,
      // Configs saved before this flag existed only ever held an auto-detected path.
      logPathAuto: typeof stored.logPathAuto === 'boolean' ? stored.logPathAuto : true,
      overlayHotkey:
        typeof stored.overlayHotkey === 'string' && stored.overlayHotkey
          ? stored.overlayHotkey
          : DEFAULT_CONFIG.overlayHotkey,
      overlayPanelEnabled: stored.overlayPanelEnabled !== false,
      overlayPanelBounds: readBounds(stored.overlayPanelBounds),
      overlayBarBounds: readBounds(stored.overlayBarBounds)
    }
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

/** Accepts a stored rectangle only if all four numbers are there and it has a size. */
export function readBounds(value: unknown): Bounds | null {
  const { x, y, width, height } = (value ?? {}) as Record<string, unknown>
  const numbers = [x, y, width, height]
  if (!numbers.every((n) => typeof n === 'number' && Number.isFinite(n))) return null
  if ((width as number) <= 0 || (height as number) <= 0) return null
  return { x: Math.round(x as number), y: Math.round(y as number), width: Math.round(width as number), height: Math.round(height as number) }
}

export function saveConfig(file: string, config: AppConfig): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(config, null, 2))
}

/** Usual places for Client.txt on Windows: the Steam default, Steam libraries on any drive, standalone. */
export function candidateLogPaths(): string[] {
  const game = ['steamapps', 'common', 'Path of Exile', 'logs', 'Client.txt']
  const paths = [
    win32.join('C:\\Program Files (x86)\\Steam', ...game),
    win32.join('C:\\Program Files (x86)\\Grinding Gear Games\\Path of Exile', 'logs', 'Client.txt')
  ]
  for (const drive of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
    paths.push(win32.join(`${drive}:\\SteamLibrary`, ...game))
    paths.push(win32.join(`${drive}:\\Steam`, ...game))
    paths.push(win32.join(`${drive}:\\Games\\Steam`, ...game))
  }
  return paths
}

function modifiedAt(path: string): number | null {
  try {
    return statSync(path).mtimeMs
  } catch {
    return null
  }
}

/**
 * Picks the Client.txt the game wrote to most recently. Several can exist at once
 * (an old standalone install next to the Steam one); only the newest is the live one.
 */
export function detectLogPath(
  candidates: string[] = process.platform === 'win32' ? candidateLogPaths() : [],
  mtimeOf: (path: string) => number | null = modifiedAt
): string | null {
  let best: { path: string; mtime: number } | null = null
  for (const path of candidates) {
    const mtime = mtimeOf(path)
    if (mtime != null && (!best || mtime > best.mtime)) best = { path, mtime }
  }
  return best?.path ?? null
}
