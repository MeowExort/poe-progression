import type { GemAttribute, PobBuild, VendorSearch } from '@shared/plan'
import { GEMS } from './route/data'

/** The in-game search box has been limited to 50 characters; every string stays within that. */
export const SEARCH_LIMIT = 50
/** Items can have four sockets from item level 25 on. */
const FOUR_SOCKETS_FROM = 25
const GROUPS_SHOWN = 3

const COLOUR: Record<GemAttribute, string> = { strength: 'r', dexterity: 'g', intelligence: 'b', none: '.' }

function permutations(colours: string[]): string[] {
  if (colours.length <= 1) return [colours.join('')]
  const result = new Set<string>()
  colours.forEach((colour, i) => {
    for (const rest of permutations([...colours.slice(0, i), ...colours.slice(i + 1)])) result.add(`${colour}-${rest}`)
  })
  return [...result]
}

/**
 * A search string that highlights items with these colours linked, in any order. Exact while
 * it fits the search box; otherwise "any of these colours", which also shows a few items
 * with the wrong mix.
 */
export function linkPattern(colours: string[]): { pattern: string; exact: boolean } {
  const exact = permutations([...colours].sort()).join('|')
  if (exact.length <= SEARCH_LIMIT) return { pattern: exact, exact: true }
  const any = colours.includes('.') ? '.' : `[${[...new Set(colours)].sort().join('')}]`
  return { pattern: colours.map(() => any).join('-'), exact: false }
}

/**
 * Strings to paste into a vendor's search box at the given character level: the linked
 * sockets the build's gem groups need by now, and movement speed.
 */
export function vendorSearches(pob: PobBuild, setIndexes: number[], level: number): VendorSearch[] {
  const size = level >= FOUR_SOCKETS_FROM ? 4 : 3
  const searches: VendorSearch[] = []
  const seen = new Set<string>()

  const groups = setIndexes
    .flatMap((index) => pob.skillSets[index]?.groups ?? [])
    .map((group) => group.gems.filter((gem) => gem.id !== null && (GEMS[gem.id]?.required_level ?? 1) <= level))
    // Links only matter where supports are: a group of auras works in unlinked sockets.
    .filter((gems) => gems.some((gem) => gem.support) && gems.some((gem) => !gem.support))
    .map((gems) => [...gems.filter((gem) => !gem.support).slice(0, 1), ...gems.filter((gem) => gem.support)])
    .sort((a, b) => b.length - a.length)

  for (const gems of groups) {
    if (searches.length >= GROUPS_SHOWN) break
    const linked = gems.slice(0, size)
    const colours = linked.map((gem) => COLOUR[gem.attribute])
    const { pattern, exact } = linkPattern(colours)
    if (seen.has(pattern)) continue
    seen.add(pattern)
    const main = linked[0]
    searches.push({
      label: `Связка под ${main.name}: ${colours.map((colour) => (colour === '.' ? '?' : colour.toUpperCase())).join('-')}`,
      pattern,
      note: exact ? null : 'Строка не уместилась бы в поиск целиком: подсветит и вещи с другим сочетанием этих цветов.'
    })
  }

  searches.push({
    label: 'Скорость передвижения: ботинки и Quicksilver Flask',
    pattern: '"movement speed"',
    note: null
  })
  return searches
}
