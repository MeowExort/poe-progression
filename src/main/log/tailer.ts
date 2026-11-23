import { EventEmitter } from 'node:events'
import { open, type FileHandle } from 'node:fs/promises'

export interface TailerOptions {
  /** How often to check the file for growth. */
  pollMs?: number
  /** How much of the existing file to replay on start, to restore the current state. */
  backfillBytes?: number
  /** Where the previous launch stopped reading this file, to pick up what was written since. */
  resumeFrom?: number
  /** Gives up resuming when more than this was written in the meantime. */
  maxResumeBytes?: number
}

interface TailerEvents {
  /** Lines that were already in the file when tailing started (oldest first). */
  backfill: [lines: string[]]
  /** Lines appended while tailing. */
  lines: [lines: string[]]
  /**
   * Emitted once, right after the backfill: the lines written since the previous launch
   * stopped reading, or null when that could not be worked out (no saved position, the file
   * was replaced, or too much was written).
   */
  resume: [lines: string[] | null]
  /** Emitted when the file appears or disappears. */
  found: [found: boolean]
  /** Emitted when the file's size or modification time changes, or new lines were read. */
  stats: [stats: TailerStats]
}

export interface TailerStats {
  size: number
  modifiedAt: number
  /** Lines read since tailing started, not counting the backfill. */
  liveLines: number
}

const READ_CHUNK = 64 * 1024

/**
 * Follows a growing text file by polling. The game keeps Client.txt open and appends to it,
 * and Windows updates neither change notifications nor the size recorded in the directory
 * until the writer flushes or closes the file. So every poll opens the file and reads from the
 * last position until nothing more comes back, instead of trusting the reported size.
 */
export class LogTailer extends EventEmitter<TailerEvents> {
  private readonly pollMs: number
  private readonly backfillBytes: number
  private readonly resumeFrom: number | null
  private readonly maxResumeBytes: number
  private timer: NodeJS.Timeout | null = null
  private position = 0
  private remainder: Buffer = Buffer.alloc(0)
  private found: boolean | null = null
  private started = false
  private busy = false
  private liveLines = 0
  private lastStats = ''

  constructor(
    readonly path: string,
    options: TailerOptions = {}
  ) {
    super()
    this.pollMs = options.pollMs ?? 500
    this.backfillBytes = options.backfillBytes ?? 512 * 1024
    this.resumeFrom = options.resumeFrom ?? null
    this.maxResumeBytes = options.maxResumeBytes ?? 8 * 1024 * 1024
  }

  /**
   * How far the file has been fully processed: everything before this was delivered as whole
   * lines. Save it to resume from here after a restart.
   */
  get processedPosition(): number {
    return this.position - this.remainder.length
  }

  start(): void {
    if (this.timer) return
    void this.poll()
    this.timer = setInterval(() => void this.poll(), this.pollMs)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** One polling step. Exposed for tests. */
  async poll(): Promise<void> {
    if (this.busy) return
    this.busy = true
    try {
      await this.step()
    } finally {
      this.busy = false
    }
  }

  private async step(): Promise<void> {
    let handle: FileHandle
    try {
      handle = await open(this.path, 'r')
    } catch {
      this.setFound(false)
      return
    }
    try {
      this.setFound(true)
      const stats = await handle.stat()

      if (!this.started) {
        this.started = true
        const from = Math.max(0, stats.size - this.backfillBytes)
        const chunk = await this.readToEnd(handle, from)
        this.position = from + chunk.length
        const lines = this.split(chunk)
        // The backfill window usually starts mid-line: drop that first fragment.
        if (from > 0) lines.shift()
        if (lines.length) this.emit('backfill', lines)
        this.emit('resume', await this.readMissed(handle, from + chunk.length))
        this.reportStats(this.position, stats.mtimeMs)
        return
      }

      let chunk = await this.readToEnd(handle, this.position)
      if (!chunk.length && stats.size < this.position) {
        // Truncated or replaced: start over from the beginning.
        this.position = 0
        this.remainder = Buffer.alloc(0)
        chunk = await this.readToEnd(handle, 0)
      }
      this.position += chunk.length
      const lines = this.split(chunk)
      this.liveLines += lines.length
      if (lines.length) this.emit('lines', lines)
      this.reportStats(Math.max(stats.size, this.position), stats.mtimeMs)
    } finally {
      await handle.close()
    }
  }

  /** The whole lines between the saved position and `end`, or null when resuming is not possible. */
  private async readMissed(handle: FileHandle, end: number): Promise<string[] | null> {
    const from = this.resumeFrom
    // A position past the end means another file sits at this path now.
    if (from === null || from < 0 || from > end || end - from > this.maxResumeBytes) return null
    if (from === end) return []
    const chunk = (await this.readToEnd(handle, from)).subarray(0, end - from)
    const lastNewline = chunk.lastIndexOf(0x0a)
    if (lastNewline === -1) return []
    return chunk
      .subarray(0, lastNewline)
      .toString('utf8')
      .split('\n')
      .map((line) => line.replace(/\r$/, ''))
      .filter((line) => line.length > 0)
  }

  private async readToEnd(handle: FileHandle, from: number): Promise<Buffer> {
    const chunks: Buffer[] = []
    let position = from
    for (;;) {
      const buffer = Buffer.alloc(READ_CHUNK)
      const { bytesRead } = await handle.read(buffer, 0, READ_CHUNK, position)
      if (!bytesRead) break
      chunks.push(buffer.subarray(0, bytesRead))
      position += bytesRead
    }
    return chunks.length === 1 ? chunks[0] : Buffer.concat(chunks)
  }

  private reportStats(size: number, modifiedAt: number): void {
    const key = `${size}:${modifiedAt}:${this.liveLines}`
    if (key === this.lastStats) return
    this.lastStats = key
    this.emit('stats', { size, modifiedAt, liveLines: this.liveLines })
  }

  /** Splits on newlines at the byte level so a multi-byte character is never cut in half. */
  private split(chunk: Buffer): string[] {
    const data = this.remainder.length ? Buffer.concat([this.remainder, chunk]) : chunk
    const lastNewline = data.lastIndexOf(0x0a)
    if (lastNewline === -1) {
      this.remainder = data
      return []
    }
    this.remainder = data.subarray(lastNewline + 1)
    return data
      .subarray(0, lastNewline)
      .toString('utf8')
      .split('\n')
      .map((line) => line.replace(/\r$/, ''))
      .filter((line) => line.length > 0)
  }

  private setFound(found: boolean): void {
    if (this.found === found) return
    this.found = found
    this.emit('found', found)
  }
}
