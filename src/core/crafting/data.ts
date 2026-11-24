import methodsJson from '@data/crafting-methods.json'
import basesJson from '@data/vendor/pob/bases.json'
import modsJson from '@data/vendor/pob/mods.json'
import genesisJson from '@data/vendor/poedb/genesis-tree.json'

export interface BaseData {
  type: string
  level: number
  /** For armour: which defences the base has, e.g. "Armour/Evasion". */
  sub?: string
  /** What decides which modifiers can roll on the base, and how often. */
  tags?: string[]
  /** Influenced items add "<this>_shaper", "<this>_elder" and so on to the tags. */
  influence?: string
  /** Which of "str", "dex", "int" the base requires. */
  attributes?: string[]
}

export interface ModData {
  type: 'Prefix' | 'Suffix'
  /** One line per stat, values as ranges: "+(100-114) to maximum Life". */
  stats: string[]
  level: number
  group: string
  tags: string[]
  /** Spawn weight per item tag; the first tag the item has decides. */
  weights?: [string, number][]
  /** Where the modifier comes from when it does not simply roll. */
  source?: 'veiled' | 'delve' | 'essence'
}

export interface BenchCraft extends Omit<ModData, 'weights' | 'source'> {
  /** Item types the craft can be put on. */
  types: string[]
}

export interface EssenceData {
  name: string
  tier: number
  /** Item type → id of the modifier the essence guarantees on it. */
  mods: Record<string, string>
}

export interface FossilData {
  name: string
  more: string[]
  moreFactor?: number
  fewer?: string[]
  none?: string[]
}

export interface GenesisNode {
  name: string
  tree: 'Equipment' | 'Currency' | 'Unique Items' | 'Miscellany'
  kind: string
  stats: string[]
}

export const BASES = basesJson as unknown as Record<string, BaseData>
const modData = modsJson as unknown as { mods: Record<string, ModData>; essences: EssenceData[]; bench: BenchCraft[] }
export const MODS = modData.mods
export const ESSENCES = modData.essences
export const BENCH = modData.bench
export const GENESIS = genesisJson as unknown as GenesisNode[]
export const METHODS = methodsJson as unknown as {
  source: { label: string; url: string }
  fossils: FossilData[]
  fossilFactor: { more: number; fewer: number; none: number }
  harvest: { tag: string; label: string; cost: string }[]
  genesis: {
    source: { label: string; url: string }
    modifierNodes: Record<string, string>
    equipmentSlots: Record<string, string>
    uniqueSlots: Record<string, string>
  }
}

/** Path of Building's names of the influences → the suffix of the tag an influenced item gets. */
export const INFLUENCE_TAG: Record<string, string> = {
  Shaper: 'shaper',
  Elder: 'elder',
  Crusader: 'crusader',
  Redeemer: 'eyrie',
  Hunter: 'basilisk',
  Warlord: 'adjudicator'
}
