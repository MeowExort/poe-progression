import { EventEmitter } from 'node:events'
import { open, stat } from 'node:fs/promises'

export interface TailerOptions {
  /** How often to check the file for growth. */
  pollMs?: number
  /** How much of the existing file to replay on start, to restore the current state. */
  backfillBytes?: number
}

interface TailerEvents {
  /** Lines that were already in the file when tailing started (oldest first). */
  backfill: [lines: string[]]
  /** Lines appended while tailing. */
  lines: [lines: string[]]
  /** Emitted when the file appears or disappears. */
  found: [found: boolean]
}

/**
 * Follows a growing text file by polling its size. The game keeps Client.txt open and
 * appends to it; file-watch notifications are unreliable for it, a size poll is not.
 */
export class LogTailer extends EventEmitter<TailerEvents> {
  private readonly pollMs: number
  private readonly backfillBytes: number
  private timer: NodeJS.Timeout | null = null
  private position = 0
  private remainder: Buffer = Buffer.alloc(0)
  private found: boolean | null = null
  private started = false
  private busy = false

  constructor(
    readonly path: string,
    options: TailerOptions = {}
  ) {
    super()
    this.pollMs = options.pollMs ?? 500
    this.backfillBytes = options.backfillBytes ?? 512 * 1024
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
    let size: number
    try {
      size = (await stat(this.path)).size
    } catch {
      this.setFound(false)
      return
    }
    this.setFound(true)

    if (!this.started) {
      this.started = true
      const from = Math.max(0, size - this.backfillBytes)
      const chunk = await this.read(from, size)
      this.position = size
      const lines = this.split(chunk)
      // The backfill window usually starts mid-line: drop that first fragment.
      if (from > 0) lines.shift()
      if (lines.length) this.emit('backfill', lines)
      return
    }

    if (size < this.position) {
      // Truncated or replaced (the game does this when the log is cleared).
      this.position = 0
      this.remainder = Buffer.alloc(0)
    }
    if (size === this.position) return

    const chunk = await this.read(this.position, size)
    this.position += chunk.length
    const lines = this.split(chunk)
    if (lines.length) this.emit('lines', lines)
  }

  private async read(from: number, to: number): Promise<Buffer> {
    const length = to - from
    if (length <= 0) return Buffer.alloc(0)
    const handle = await open(this.path, 'r')
    try {
      const buffer = Buffer.alloc(length)
      const { bytesRead } = await handle.read(buffer, 0, length, from)
      return buffer.subarray(0, bytesRead)
    } finally {
      await handle.close()
    }
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
