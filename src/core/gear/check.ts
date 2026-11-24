import type { CharacterGear, GearCheck, GearModCheck, GearSlotCheck, PobBuild, PobItem, WornItem } from '@shared/plan'
import { statKey, statRanges } from '../crafting/match'

const text = (value: unknown): string => (typeof value === 'string' ? value : '')

/** The site's "frame type" of an item → its rarity. */
const RARITY: Record<number, WornItem['rarity']> = { 0: 'Normal', 1: 'Magic', 2: 'Rare', 3: 'Unique' }

/** Path of Building's names of the slots → the site's. Flasks and jewels are not compared. */
const SITE_SLOT: Record<string, string> = {
  'Weapon 1': 'Weapon',
  'Weapon 2': 'Offhand',
  'Weapon 1 Swap': 'Weapon2',
  'Weapon 2 Swap': 'Offhand2',
  Helmet: 'Helm',
  'Body Armour': 'BodyArmour',
  Gloves: 'Gloves',
  Boots: 'Boots',
  Amulet: 'Amulet',
  Belt: 'Belt',
  'Ring 1': 'Ring',
  'Ring 2': 'Ring2'
}

function lines(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((mod) => (typeof mod === 'string' ? mod : text((mod as { description?: unknown } | null)?.description))).filter(Boolean)
}

/** What the character wears, from the site's answer about its items. */
export function readCharacterGear(body: unknown): CharacterGear | null {
  const items = (body as { items?: unknown } | null)?.items
  if (!Array.isArray(items)) return null
  const worn: WornItem[] = []
  const carriedUniques: string[] = []
  for (const raw of items) {
    const item = (raw ?? {}) as Record<string, unknown>
    const slot = text(item.inventoryId)
    const rarity = RARITY[typeof item.frameType === 'number' ? item.frameType : -1]
    if (slot === 'MainInventory') {
      if (rarity === 'Unique' && text(item.name)) carriedUniques.push(text(item.name))
      continue
    }
    if (!rarity || !Object.values(SITE_SLOT).includes(slot)) continue
    const groups = new Map<number, number>()
    for (const socket of Array.isArray(item.sockets) ? (item.sockets as { group?: unknown }[]) : []) {
      if (typeof socket?.group === 'number') groups.set(socket.group, (groups.get(socket.group) ?? 0) + 1)
    }
    worn.push({
      slot,
      name: text(item.name),
      base: text(item.baseType) || text(item.typeLine),
      rarity,
      links: Math.max(0, ...groups.values()),
      itemLevel: typeof item.ilvl === 'number' ? item.ilvl : null,
      mods: [...lines(item.explicitMods), ...lines(item.craftedMods), ...lines(item.fracturedMods)]
    })
  }
  return { worn, carriedUniques }
}

const isUnique = (item: PobItem): boolean => item.rarity === 'UNIQUE' || item.rarity === 'RELIC'

/** The first number of a line, sign dropped: what its size is judged by. */
function size(line: string): number | null {
  const range = statRanges(line)[0]
  return range ? Math.abs(range[0]) : null
}

function compareMods(wanted: PobItem, worn: WornItem): GearModCheck[] {
  const free = [...worn.mods]
  return wanted.mods.map((mod) => {
    const index = free.findIndex((line) => statKey(line) === statKey(mod.text))
    if (index === -1) return { text: mod.text, state: 'absent', worn: null }
    const [line] = free.splice(index, 1)
    const need = size(mod.text)
    const have = size(line)
    return { text: mod.text, state: need === null || have === null || have >= need ? 'have' : 'lower', worn: line }
  })
}

function compareSlot(slot: string, wanted: PobItem, worn: WornItem | undefined, carried: Set<string>): GearSlotCheck {
  const unique = isUnique(wanted)
  const check: GearSlotCheck = {
    slot,
    wanted: { name: wanted.name, base: wanted.base, unique, links: wanted.links },
    worn: worn ? { name: worn.name || worn.base, base: worn.base, unique: worn.rarity === 'Unique', links: worn.links } : null,
    state: 'empty',
    mods: [],
    notes: []
  }
  if (unique) {
    if (worn?.rarity === 'Unique' && worn.name === wanted.name) check.state = 'match'
    else {
      check.state = worn ? 'different' : 'empty'
      if (carried.has(wanted.name)) check.notes.push('Этот уник лежит в инвентаре.')
      // A Foulborn unique is a version of the plain one.
      else if (wanted.name.startsWith('Foulborn ') && worn?.name === wanted.name.slice('Foulborn '.length)) {
        check.state = 'partial'
        check.notes.push('Надета обычная версия, в билде — Foulborn.')
      }
    }
  } else if (worn) {
    check.mods = compareMods(wanted, worn)
    const has = check.mods.filter((mod) => mod.state !== 'absent').length
    const full = check.mods.filter((mod) => mod.state === 'have').length
    check.state = !check.mods.length ? 'partial' : full === check.mods.length ? 'match' : has > 0 ? 'partial' : 'different'
    if (wanted.base && worn.base !== wanted.base) check.notes.push(`База другая: в билде ${wanted.base}.`)
  }
  if (worn && check.wanted.links > 1 && worn.links < check.wanted.links) {
    check.notes.push(`Связей ${worn.links} из ${check.wanted.links}.`)
  }
  return check
}

/** How alike a slot is, for choosing the item set and the order of the rings. */
function likeness(check: GearSlotCheck): number {
  if (check.state === 'match') return 2
  if (check.state !== 'partial') return 0
  return check.mods.length ? check.mods.filter((mod) => mod.state !== 'absent').length / check.mods.length : 0.5
}

function compareSet(items: PobItem[], gear: CharacterGear): GearSlotCheck[] {
  const carried = new Set(gear.carriedUniques)
  const wornAt = (slot: string): WornItem | undefined => gear.worn.find((item) => item.slot === slot)
  const slots = items.filter((item) => SITE_SLOT[item.slot]).map((item) => compareSlot(item.slot, item, wornAt(SITE_SLOT[item.slot]), carried))

  // The two rings are interchangeable: compare them the way round that fits better.
  const rings = items.filter((item) => item.slot === 'Ring 1' || item.slot === 'Ring 2')
  if (rings.length) {
    const other = (site: string): string => (site === 'Ring' ? 'Ring2' : 'Ring')
    const total = (checks: GearSlotCheck[]): number => checks.reduce((sum, slot) => sum + likeness(slot), 0)
    const straight = slots.filter((slot) => rings.some((ring) => ring.slot === slot.slot))
    const swapped = rings.map((ring) => compareSlot(ring.slot, ring, wornAt(other(SITE_SLOT[ring.slot])), carried))
    if (total(swapped) > total(straight)) return slots.map((slot) => swapped.find((entry) => entry.slot === slot.slot) ?? slot)
  }
  return slots
}

/**
 * Compares the build's items with what the character wears. Of the build's item sets the one
 * the worn items are most like is taken. A unique matches by name; a rare is compared modifier
 * by modifier: does the worn item have the same stat, and at least as high.
 */
export function checkGear(pob: PobBuild, gear: CharacterGear, character: string, readAt: number): GearCheck | null {
  let best: { index: number; slots: GearSlotCheck[]; score: number } | null = null
  pob.itemSets.forEach((set, index) => {
    const slots = compareSet(set.items, gear)
    if (!slots.length) return
    const score = slots.reduce((sum, slot) => sum + likeness(slot), 0)
    if (!best || score > best.score) best = { index, slots, score }
  })
  const chosen = best as { index: number; slots: GearSlotCheck[] } | null
  if (!chosen) return null
  return { setIndex: chosen.index, setTitle: pob.itemSets[chosen.index].title, slots: chosen.slots, character, readAt }
}
