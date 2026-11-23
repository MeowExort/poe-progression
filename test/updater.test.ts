import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { notesToLines, Updater, type UpdateSource } from '../src/main/updater'
import type { UpdateState } from '../src/shared/update'

/** Stands in for electron-updater: events are fired by hand. */
class FakeSource implements UpdateSource {
  autoDownload = false
  autoInstallOnAppQuit = false
  checks = 0
  installs: unknown[][] = []
  failWith: Error | null = null
  private readonly listeners = new Map<string, ((...args: any[]) => void)[]>()

  on(event: string, listener: (...args: any[]) => void): this {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener])
    return this
  }

  emit(event: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) listener(...args)
  }

  async checkForUpdates(): Promise<unknown> {
    this.checks++
    if (this.failWith) throw this.failWith
    return null
  }

  quitAndInstall(...args: unknown[]): void {
    this.installs.push(args)
  }
}

function setup(options: { current?: string; file?: string | null; enabled?: boolean } = {}) {
  const source = new FakeSource()
  const states: UpdateState[] = []
  const updater = new Updater({
    current: options.current ?? '0.1.0',
    enabled: options.enabled ?? true,
    source,
    file: options.file ?? null,
    onChange: (state) => states.push(state),
    now: () => 1000
  })
  return { source, states, updater }
}

const NOTES = '<h3>Sanctum</h3>\n<ul>\n<li>Забег продолжается после перезапуска.</li>\n<li>Цены &amp; ссылки.</li>\n</ul>'

describe('notesToLines', () => {
  it('turns the HTML of a release into headings and bullets', () => {
    expect(notesToLines(NOTES)).toEqual(['Sanctum', '• Забег продолжается после перезапуска.', '• Цены & ссылки.'])
  })

  it('reads plain markdown too', () => {
    expect(notesToLines('### Полоска\n\n- Раз\n* Два\n')).toEqual(['### Полоска', '• Раз', '• Два'])
  })

  it('joins the notes of several versions', () => {
    expect(
      notesToLines([
        { version: '0.3.0', note: '<ul><li>Новое</li></ul>' },
        { version: '0.2.0', note: '<ul><li>Старое</li></ul>' }
      ])
    ).toEqual(['• Новое', '• Старое'])
  })

  it('gives nothing for missing notes', () => {
    expect(notesToLines(null)).toEqual([])
    expect(notesToLines(undefined)).toEqual([])
  })
})

describe('Updater', () => {
  it('does nothing when running from source', async () => {
    const { source, updater } = setup({ enabled: false })
    expect(updater.view().status).toBe('disabled')
    await updater.check()
    expect(source.checks).toBe(0)
    expect(source.autoDownload).toBe(false)
  })

  it('downloads in the background and installs on quit', () => {
    const { source, updater } = setup()
    expect(updater.view().status).toBe('idle')
    expect(source.autoDownload).toBe(true)
    expect(source.autoInstallOnAppQuit).toBe(true)
  })

  it('walks from a check to a downloaded update', () => {
    const { source, updater } = setup()
    source.emit('checking-for-update')
    expect(updater.view().status).toBe('checking')

    source.emit('update-available', { version: '0.2.0', releaseNotes: NOTES })
    expect(updater.view()).toMatchObject({ status: 'downloading', version: '0.2.0', progress: 0, checkedAt: 1000 })
    expect(updater.view().notes).toHaveLength(3)

    source.emit('download-progress', { percent: 41.6 })
    expect(updater.view().progress).toBe(42)

    source.emit('update-downloaded', { version: '0.2.0', releaseNotes: NOTES })
    expect(updater.view()).toMatchObject({ status: 'ready', version: '0.2.0', progress: 100 })
  })

  it('reports that nothing newer exists', () => {
    const { source, updater } = setup()
    source.emit('checking-for-update')
    source.emit('update-not-available', { version: '0.1.0' })
    expect(updater.view()).toMatchObject({ status: 'idle', version: null, checkedAt: 1000 })
  })

  it('does not start a second check while one is running', async () => {
    const { source, updater } = setup()
    source.emit('checking-for-update')
    await updater.check()
    source.emit('update-available', { version: '0.2.0' })
    await updater.check()
    expect(source.checks).toBe(0)
  })

  it('installs only a downloaded update, restarting the app afterwards', () => {
    const { source, updater } = setup()
    updater.install()
    expect(source.installs).toEqual([])
    source.emit('update-downloaded', { version: '0.2.0' })
    updater.install()
    expect(source.installs).toEqual([[true, true]])
  })

  it('keeps a downloaded update when a later check fails', async () => {
    const { source, updater } = setup()
    source.emit('update-downloaded', { version: '0.2.0', releaseNotes: NOTES })
    source.emit('checking-for-update')
    source.emit('error', new Error('net::ERR_INTERNET_DISCONNECTED'))
    source.failWith = new Error('boom')
    await updater.check()
    expect(updater.view()).toMatchObject({ status: 'ready', version: '0.2.0', error: null })
  })

  it('explains a failed check in plain words', async () => {
    const offline = setup()
    offline.source.failWith = new Error('net::ERR_NAME_NOT_RESOLVED')
    await offline.updater.check()
    expect(offline.updater.view()).toMatchObject({ status: 'error', error: 'Нет связи с GitHub — проверю позже.' })

    const empty = setup()
    empty.source.emit('error', new Error('Cannot find latest.yml in the latest release artifacts: HttpError: 404'))
    expect(empty.updater.view().error).toBe('На GitHub пока нет опубликованных версий.')

    // The next check clears the message.
    empty.source.emit('checking-for-update')
    expect(empty.updater.view()).toMatchObject({ status: 'checking', error: null })
  })

  it('shows what changed on the first launch of the new version, once', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'poe-update-')), 'nested', 'update.json')

    const before = setup({ current: '0.1.0', file })
    before.source.emit('update-available', { version: '0.2.0', releaseNotes: NOTES })
    before.source.emit('update-downloaded', { version: '0.2.0' })
    expect(before.updater.view().whatsNew).toBeNull()

    // Closed without installing: still the old version, nothing to announce.
    expect(setup({ current: '0.1.0', file }).updater.view().whatsNew).toBeNull()

    const after = setup({ current: '0.2.0', file })
    expect(after.updater.view().whatsNew).toEqual({
      version: '0.2.0',
      notes: ['Sanctum', '• Забег продолжается после перезапуска.', '• Цены & ссылки.']
    })

    after.updater.dismissWhatsNew()
    expect(after.updater.view().whatsNew).toBeNull()
    expect(after.states.at(-1)?.whatsNew).toBeNull()
    expect(setup({ current: '0.2.0', file }).updater.view().whatsNew).toBeNull()
    expect(readFileSync(file, 'utf8')).toBe('null')
  })

  it('ignores a damaged notes file', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'poe-update-')), 'update.json')
    writeFileSync(file, '{"version": 2')
    expect(setup({ current: '0.2.0', file }).updater.view().whatsNew).toBeNull()
  })
})
