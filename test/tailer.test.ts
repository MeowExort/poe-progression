import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LogTailer } from '../src/main/log/tailer'

let dir: string
let file: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tailer-'))
  file = join(dir, 'Client.txt')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

function collect(tailer: LogTailer) {
  const seen = { backfill: [] as string[], lines: [] as string[], found: [] as boolean[], resume: [] as (string[] | null)[] }
  tailer.on('resume', (lines) => seen.resume.push(lines))
  tailer.on('backfill', (lines) => seen.backfill.push(...lines))
  tailer.on('lines', (lines) => seen.lines.push(...lines))
  tailer.on('found', (found) => seen.found.push(found))
  return seen
}

describe('LogTailer', () => {
  it('replays existing lines as backfill, then reports appended lines', async () => {
    writeFileSync(file, 'one\r\ntwo\r\n')
    const tailer = new LogTailer(file)
    const seen = collect(tailer)

    await tailer.poll()
    expect(seen.backfill).toEqual(['one', 'two'])

    appendFileSync(file, 'three\r\nfour\r\n')
    await tailer.poll()
    expect(seen.lines).toEqual(['three', 'four'])
  })

  it('holds back an unfinished line until its newline arrives', async () => {
    writeFileSync(file, '')
    const tailer = new LogTailer(file)
    const seen = collect(tailer)
    await tailer.poll()

    appendFileSync(file, 'first\npart')
    await tailer.poll()
    expect(seen.lines).toEqual(['first'])

    appendFileSync(file, 'ial\n')
    await tailer.poll()
    expect(seen.lines).toEqual(['first', 'partial'])
  })

  it('does not split a multi-byte character across two reads', async () => {
    writeFileSync(file, '')
    const tailer = new LogTailer(file)
    const seen = collect(tailer)
    await tailer.poll()

    const bytes = Buffer.from('Привет\n', 'utf8')
    appendFileSync(file, bytes.subarray(0, 3))
    await tailer.poll()
    appendFileSync(file, bytes.subarray(3))
    await tailer.poll()
    expect(seen.lines).toEqual(['Привет'])
  })

  it('limits backfill to the tail of the file and drops the cut first line', async () => {
    writeFileSync(file, 'aaaaaaaaaa\nbbbb\ncccc\n')
    const tailer = new LogTailer(file, { backfillBytes: 12 })
    const seen = collect(tailer)
    await tailer.poll()
    expect(seen.backfill).toEqual(['bbbb', 'cccc'])
  })

  it('starts over when the file is truncated', async () => {
    writeFileSync(file, 'old line one\nold line two\n')
    const tailer = new LogTailer(file)
    const seen = collect(tailer)
    await tailer.poll()

    writeFileSync(file, 'new\n')
    await tailer.poll()
    expect(seen.lines).toEqual(['new'])
  })

  it('reads appended data in chunks larger than one read', async () => {
    writeFileSync(file, '')
    const tailer = new LogTailer(file)
    const seen = collect(tailer)
    await tailer.poll()

    const long = Array.from({ length: 5000 }, (_, i) => `line number ${i} with some padding text`)
    appendFileSync(file, long.join('\n') + '\n')
    await tailer.poll()
    expect(seen.lines).toEqual(long)
  })

  it('reports size, modification time and the number of live lines', async () => {
    writeFileSync(file, 'old\n')
    const tailer = new LogTailer(file)
    const stats: { size: number; liveLines: number }[] = []
    tailer.on('stats', (s) => stats.push({ size: s.size, liveLines: s.liveLines }))

    await tailer.poll()
    await tailer.poll()
    appendFileSync(file, 'a\nb\n')
    await tailer.poll()
    expect(stats).toEqual([
      { size: 4, liveLines: 0 },
      { size: 8, liveLines: 2 }
    ])
  })

  it('reports a missing file and picks it up once it appears', async () => {
    const tailer = new LogTailer(file)
    const seen = collect(tailer)
    await tailer.poll()
    expect(seen.found).toEqual([false])

    writeFileSync(file, 'hello\n')
    await tailer.poll()
    expect(seen.found).toEqual([false, true])
    expect(seen.backfill).toEqual(['hello'])
  })

  describe('resuming after a restart', () => {
    it('reports its position at the end of the last whole line', async () => {
      writeFileSync(file, 'one\ntwo\npart')
      const tailer = new LogTailer(file)
      await tailer.poll()
      expect(tailer.processedPosition).toBe('one\ntwo\n'.length)
    })

    it('delivers what was written since the saved position, once, then carries on', async () => {
      writeFileSync(file, 'one\ntwo\n')
      const first = new LogTailer(file)
      await first.poll()
      const saved = first.processedPosition

      appendFileSync(file, 'three\r\nfour\r\nfi')
      const second = new LogTailer(file, { resumeFrom: saved })
      const seen = collect(second)
      await second.poll()
      expect(seen.resume).toEqual([['three', 'four']])
      expect(seen.backfill).toEqual(['one', 'two', 'three', 'four'])

      appendFileSync(file, 've\n')
      await second.poll()
      expect(seen.lines).toEqual(['five'])
      expect(seen.resume).toHaveLength(1)
    })

    it('finishes a line that was cut in half when the position was saved', async () => {
      writeFileSync(file, 'one\nhal')
      const first = new LogTailer(file)
      await first.poll()
      appendFileSync(file, 'f\nnext\n')
      const seen = collect(new LogTailer(file, { resumeFrom: first.processedPosition }))
      const second = new LogTailer(file, { resumeFrom: first.processedPosition })
      const again = collect(second)
      await second.poll()
      expect(again.resume).toEqual([['half', 'next']])
      expect(seen.resume).toEqual([])
    })

    it('says nothing was missed when the file did not grow', async () => {
      writeFileSync(file, 'one\n')
      const seen = collect(new LogTailer(file, { resumeFrom: 4 }))
      const tailer = new LogTailer(file, { resumeFrom: 4 })
      const live = collect(tailer)
      await tailer.poll()
      expect(live.resume).toEqual([[]])
      expect(seen.resume).toEqual([])
    })

    it.each([
      ['there is no saved position', {}],
      ['the file is shorter than the saved position (another file now)', { resumeFrom: 9999 }],
      ['too much was written in the meantime', { resumeFrom: 0, maxResumeBytes: 3 }]
    ])('cannot resume when %s', async (_name, options) => {
      writeFileSync(file, 'one\ntwo\n')
      const tailer = new LogTailer(file, options)
      const seen = collect(tailer)
      await tailer.poll()
      expect(seen.resume).toEqual([null])
    })

    it('tries to resume when the file only appears later', async () => {
      const tailer = new LogTailer(file, { resumeFrom: 0 })
      const seen = collect(tailer)
      await tailer.poll()
      expect(seen.resume).toEqual([])
      writeFileSync(file, 'hello\n')
      await tailer.poll()
      expect(seen.resume).toEqual([['hello']])
    })
  })
})
