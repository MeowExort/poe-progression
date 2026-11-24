import type { PobMod } from '@shared/plan'
import { INFLUENCE_TAG, MODS, type BaseData, type ModData } from './data'

/** The item level assumed when the build does not give one: everything can roll at it. */
export const TOP_ITEM_LEVEL = 86

/** A stat line with its numbers taken out: what two rolls of the same stat have in common. */
export function statKey(text: string): string {
  return text
    .replace(/\(-?\d+(?:\.\d+)?-+-?\d+(?:\.\d+)?\)/g, '#')
    .replace(/-?\d+(?:\.\d+)?/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/** The value ranges of a stat line: "+(100-114) to maximum Life" → [[100, 114]]; "+92…" → [[92, 92]]. */
export function statRanges(text: string): [number, number][] {
  const ranges: [number, number][] = []
  for (const match of text.matchAll(/\((-?\d+(?:\.\d+)?)-+(-?\d+(?:\.\d+)?)\)|(-?\d+(?:\.\d+)?)/g)) {
    if (match[3] !== undefined) ranges.push([+match[3], +match[3]])
    else ranges.push([Math.min(+match[1], +match[2]), Math.max(+match[1], +match[2])])
  }
  return ranges
}

/** The tags that decide what rolls on an item: those of its base, plus one per influence. */
export function itemTags(base: BaseData | undefined, influences: string[]): Set<string> {
  const tags = new Set(base?.tags ?? ['default'])
  for (const influence of influences) {
    const suffix = INFLUENCE_TAG[influence]
    if (suffix && base?.influence) tags.add(`${base.influence}_${suffix}`)
  }
  return tags
}

/** How often a modifier rolls on an item with these tags: the weight of the first tag they share. */
export function spawnWeight(mod: ModData, tags: Set<string>): number {
  for (const [tag, weight] of mod.weights ?? []) if (tags.has(tag)) return weight
  return 0
}

const byStatKey = new Map<string, string[]>()
for (const [id, mod] of Object.entries(MODS)) {
  for (const stat of mod.stats) {
    const key = statKey(stat)
    byStatKey.set(key, [...(byStatKey.get(key) ?? []), id])
  }
}

export interface MatchedMod {
  id: string
  mod: ModData
  /** True when the values of the line fit the modifier's ranges; false for the nearest guess. */
  exact: boolean
}

/** How far the values of a line are from the ranges of a stat; 0 when they fit. */
function distance(line: [number, number][], stat: [number, number][]): number {
  if (line.length !== stat.length) return Infinity
  let total = 0
  line.forEach(([low, high], i) => {
    const [min, max] = stat[i]
    const span = Math.max(1, Math.abs(max))
    if (high < min) total += (min - high) / span
    else if (low > max) total += (low - max) / span
  })
  return total
}

/**
 * Finds the game's modifier behind a line of an item. A line Path of Building wrote with its
 * ranges names the tier outright; a line with rolled values is matched to the tier whose
 * ranges hold them. Modifiers the item's tags let roll are preferred to those they do not.
 */
export function matchMod(line: PobMod, tags: Set<string>): MatchedMod | null {
  const candidates = byStatKey.get(statKey(line.text)) ?? []
  if (!candidates.length) return null
  const ranges = statRanges(line.text)
  let best: { id: string; score: number; far: number } | null = null
  for (const id of candidates) {
    const mod = MODS[id]
    const stat = mod.stats.find((entry) => statKey(entry) === statKey(line.text))!
    const far = distance(ranges, statRanges(stat))
    if (far === Infinity) continue
    // Order of preference: values fit; a single-stat modifier; one that rolls on this item.
    const score = far * 1000 + (mod.stats.length - 1) * 10 + (spawnWeight(mod, tags) > 0 ? 0 : mod.source ? 1 : 2)
    if (!best || score < best.score) best = { id, score, far }
  }
  return best ? { id: best.id, mod: MODS[best.id], exact: best.far === 0 } : null
}

/**
 * The modifiers of the same kind this item can roll, best first: the tiers. Kind means the
 * same group and the same stat lines, so hybrid modifiers do not mix with plain ones.
 */
export function tiersOf(mod: ModData, tags: Set<string>): { id: string; mod: ModData }[] {
  const shape = mod.stats.map(statKey).join('|')
  return Object.entries(MODS)
    .filter(([, other]) => other.group === mod.group && other.type === mod.type && !other.source && spawnWeight(other, tags) > 0)
    .filter(([, other]) => other.stats.map(statKey).join('|') === shape)
    .map(([id, other]) => ({ id, mod: other }))
    .sort((a, b) => b.mod.level - a.mod.level)
}

const sameText = (a: string, b: string): boolean => a.replace(/\s+/g, ' ').trim().toLowerCase() === b.replace(/\s+/g, ' ').trim().toLowerCase()

/**
 * Finds the modifier behind every line of an item. A modifier with two stats shows as two
 * lines: those are recognised together when the lines are written exactly as the modifier
 * has them, or when one of them cannot be anything else. Crafted and fractured lines are
 * matched on their own.
 */
export function matchLines(lines: PobMod[], tags: Set<string>): (MatchedMod | null)[] {
  const result: (MatchedMod | null)[] = lines.map(() => null)
  const taken = new Set<number>()
  const free = (index: number): boolean => !taken.has(index) && !lines[index].crafted && !lines[index].fractured

  const multi = new Set<string>()
  lines.forEach((line, index) => {
    if (!free(index)) return
    for (const id of byStatKey.get(statKey(line.text)) ?? []) if (MODS[id].stats.length > 1) multi.add(id)
  })
  const ordered = [...multi].sort(
    (a, b) => Number(spawnWeight(MODS[b], tags) > 0) - Number(spawnWeight(MODS[a], tags) > 0) || MODS[b].level - MODS[a].level
  )
  for (const id of ordered) {
    const mod = MODS[id]
    const used: number[] = []
    for (const stat of mod.stats) {
      const index = lines.findIndex(
        (line, i) =>
          free(i) && !used.includes(i) && statKey(line.text) === statKey(stat) && distance(statRanges(line.text), statRanges(stat)) === 0
      )
      if (index === -1) break
      used.push(index)
    }
    if (used.length !== mod.stats.length) continue
    const verbatim = used.every((index, i) => sameText(lines[index].text, mod.stats[i]))
    const forced = used.some((index) => {
      const alone = matchMod(lines[index], tags)
      return !alone || !alone.exact || alone.mod.stats.length > 1
    })
    if (!verbatim && !forced) continue
    for (const index of used) {
      taken.add(index)
      result[index] = { id, mod, exact: true }
    }
  }

  lines.forEach((line, index) => {
    if (!taken.has(index)) result[index] = matchMod(line, tags)
  })
  return result
}
