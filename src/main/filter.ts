import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { generateFilter, type FilterInput } from '@core/filter/generate'
import type { FilterView } from '@shared/filter'

export const FILTER_NAME = 'PoE Progression'

interface StoredOptions {
  enabled: boolean
  usePrices: boolean
  useBuildNames: boolean
  /** A folder the player chose; null means the game's usual one. */
  dir: string | null
}

export interface FilterWriterOptions {
  /** Where the options are kept. */
  file: string | null
  /** The folder the game reads filters from by default. */
  defaultDir: string
  /** What the filter is built from, read afresh on every refresh. */
  input: () => FilterInput
  onChange?: (view: FilterView) => void
}

/**
 * Keeps the loot filter file in the game's folder in step with the build. The file is only
 * written once the player asked for it, and only when its content changes, so the time it
 * was last changed tells whether the game has to load it again.
 */
export class FilterWriter {
  private stored: StoredOptions
  private error: string | null = null

  constructor(private readonly options: FilterWriterOptions) {
    this.stored = readOptions(options.file)
  }

  view(): FilterView {
    const generated = generateFilter(this.input())
    const path = this.path
    let writtenAt: number | null = null
    try {
      writtenAt = Math.round(statSync(path).mtimeMs)
    } catch {
      writtenAt = null
    }
    return {
      enabled: this.stored.enabled,
      usePrices: this.stored.usePrices,
      useBuildNames: this.stored.useBuildNames,
      dir: this.dir,
      dirFound: existsSync(this.dir),
      fileName: `${FILTER_NAME}.filter`,
      writtenAt,
      error: this.error,
      stages: generated.stages,
      summary: generated.summary,
      command: `/itemfilter ${FILTER_NAME}`
    }
  }

  setOptions(patch: Partial<StoredOptions>): void {
    this.stored = {
      enabled: typeof patch.enabled === 'boolean' ? patch.enabled : this.stored.enabled,
      usePrices: typeof patch.usePrices === 'boolean' ? patch.usePrices : this.stored.usePrices,
      useBuildNames: typeof patch.useBuildNames === 'boolean' ? patch.useBuildNames : this.stored.useBuildNames,
      dir: patch.dir === undefined ? this.stored.dir : typeof patch.dir === 'string' && patch.dir.trim() ? patch.dir.trim() : null
    }
    if (this.options.file) {
      try {
        mkdirSync(dirname(this.options.file), { recursive: true })
        writeFileSync(this.options.file, JSON.stringify(this.stored, null, 2))
      } catch {
        // The options then last until the app is closed.
      }
    }
    this.refresh()
  }

  /** Rebuilds the filter and, when it is switched on and differs from the file, writes it. */
  refresh(): void {
    this.error = null
    if (this.stored.enabled) {
      const { text } = generateFilter(this.input())
      const path = this.path
      try {
        if (!existsSync(this.dir)) {
          this.error = 'Папка с фильтрами не найдена: запусти игру хотя бы раз или укажи папку вручную.'
        } else if (read(path) !== text) {
          writeFileSync(path, text)
        }
      } catch {
        this.error = 'Не удалось записать файл фильтра: проверь, что папка доступна для записи.'
      }
    }
    this.options.onChange?.(this.view())
  }

  get dir(): string {
    return this.stored.dir ?? this.options.defaultDir
  }

  private get path(): string {
    return join(this.dir, `${FILTER_NAME}.filter`)
  }

  private input(): FilterInput {
    const input = this.options.input()
    return { ...input, buildNames: this.stored.useBuildNames, prices: this.stored.usePrices ? input.prices : null }
  }
}

function read(path: string): string | null {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

function readOptions(file: string | null): StoredOptions {
  const fallback: StoredOptions = { enabled: false, usePrices: true, useBuildNames: true, dir: null }
  if (!file) return fallback
  try {
    const stored = JSON.parse(readFileSync(file, 'utf8')) as Partial<StoredOptions>
    return {
      enabled: stored.enabled === true,
      usePrices: stored.usePrices !== false,
      useBuildNames: stored.useBuildNames !== false,
      dir: typeof stored.dir === 'string' && stored.dir ? stored.dir : null
    }
  } catch {
    return fallback
  }
}
