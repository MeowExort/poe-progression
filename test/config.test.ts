import { describe, expect, it } from 'vitest'
import { candidateLogPaths, detectLogPath } from '../src/main/config'

describe('detectLogPath', () => {
  it('covers Steam libraries on other drives', () => {
    expect(candidateLogPaths()).toContain('E:\\SteamLibrary\\steamapps\\common\\Path of Exile\\logs\\Client.txt')
  })

  it('prefers the most recently written file when several exist', () => {
    const mtimes: Record<string, number> = { old: 100, live: 300, older: 50 }
    expect(detectLogPath(['old', 'missing', 'live', 'older'], (path) => mtimes[path] ?? null)).toBe('live')
  })

  it('returns null when nothing exists', () => {
    expect(detectLogPath(['a', 'b'], () => null)).toBeNull()
  })
})
