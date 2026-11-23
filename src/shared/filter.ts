/** One stage of the loot filter: a range of area levels with its own strictness. */
export interface FilterStage {
  id: 'acts-early' | 'acts-late' | 'maps-white' | 'maps-yellow' | 'maps-red' | 'endgame'
  title: string
  /** Area levels the stage covers, both inclusive; `to` is null for "and above". */
  from: number
  to: number | null
  /** What of normal, magic and rare gear stays visible at this stage, in plain words. */
  shows: string[]
  hides: string[]
}

/** What the filter was built from, for the player to check. */
export interface FilterSummary {
  /** Item classes of the build's weapons, as the filter names them; empty when unknown. */
  weaponClasses: string[]
  /** "Evasion", "Armour/Energy Shield"…; empty when unknown. */
  defences: string[]
  /** Linked socket colours highlighted while levelling, e.g. "GGB". */
  links: string[]
  /** Gems of the build the filter highlights. */
  gems: number
  /** Base types of the build's uniques. */
  uniqueBases: number
  /** Items highlighted by their price; 0 when prices are off or not loaded. */
  priced: number
}

export interface FilterView {
  /** True once the player asked for the file to be written and kept up to date. */
  enabled: boolean
  /** Highlight currency and cards by their poe.ninja price. */
  usePrices: boolean
  /** Highlight the build's gems and the bases of its uniques by name. */
  useBuildNames: boolean
  /** The folder the game reads filters from, and whether it exists. */
  dir: string
  dirFound: boolean
  fileName: string
  /** When the file on disk last changed (epoch ms); null if it was never written. */
  writtenAt: number | null
  error: string | null
  stages: FilterStage[]
  summary: FilterSummary
  /** The chat command that makes the game load the filter. */
  command: string
}

export interface FilterApi {
  get(): Promise<FilterView>
  onChange(listener: (view: FilterView) => void): () => void
  setOptions(patch: { enabled?: boolean; usePrices?: boolean; useBuildNames?: boolean; dir?: string | null }): Promise<void>
  /** Opens the folder with the filter in the file manager. */
  openFolder(): Promise<void>
}

export const FILTER_IPC = {
  get: 'filter:get',
  state: 'filter:state',
  setOptions: 'filter:set-options',
  openFolder: 'filter:open-folder'
} as const
