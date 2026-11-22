import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, win32 } from 'node:path'
import type { AppConfig } from '@shared/api'

export const DEFAULT_CONFIG: AppConfig = {
  logPath: '',
  overlayHotkey: 'Shift+F'
}

export function loadConfig(file: string): AppConfig {
  try {
    const stored = JSON.parse(readFileSync(file, 'utf8')) as Partial<AppConfig>
    return {
      logPath: typeof stored.logPath === 'string' ? stored.logPath : DEFAULT_CONFIG.logPath,
      overlayHotkey:
        typeof stored.overlayHotkey === 'string' && stored.overlayHotkey
          ? stored.overlayHotkey
          : DEFAULT_CONFIG.overlayHotkey
    }
  } catch {
    return { ...DEFAULT_CONFIG }
  }
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

export function detectLogPath(exists: (path: string) => boolean = existsSync): string | null {
  if (process.platform !== 'win32') return null
  return candidateLogPaths().find(exists) ?? null
}
