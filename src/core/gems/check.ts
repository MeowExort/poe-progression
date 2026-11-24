import type { CharacterGems, GemCheck, GemGroupCheck, GemSource, GemState, PobBuild, PobGem, SocketedGem } from '@shared/plan'
import { GEMS } from '../route/data'

/** The site's "frame type" of gems. */
const GEM_FRAME = 4
/** Items can have four sockets from item level 25 on: before that three linked gems is all there is. */
const FOUR_SOCKETS_FROM = 25
const PROBLEMS_SHOWN = 6

const text = (value: unknown): string => (typeof value === 'string' ? value : '')

/** A gem name for comparing: a Vaal or Awakened gem stands in for the plain one, "Support" is dropped. */
function plain(name: string): string {
  return name
    .toLowerCase()
    .replace(/^(vaal|awakened) /, '')
    .replace(/ support$/, '')
    .trim()
}

/**
 * The gems of a character from the site's answer about its items: those socketed in the gear,
 * with the linked group each sits in, and those lying in the inventory.
 */
export function readCharacterGems(body: unknown): CharacterGems | null {
  const items = (body as { items?: unknown } | null)?.items
  if (!Array.isArray(items)) return null
  const socketed: SocketedGem[] = []
  const loose: string[] = []
  for (const raw of items) {
    const item = (raw ?? {}) as Record<string, unknown>
    const slot = text(item.inventoryId)
    if (slot === 'MainInventory') {
      if (item.frameType === GEM_FRAME && text(item.typeLine)) loose.push(text(item.typeLine))
      continue
    }
    const sockets = Array.isArray(item.sockets) ? (item.sockets as { group?: unknown }[]) : []
    for (const rawGem of Array.isArray(item.socketedItems) ? item.socketedItems : []) {
      const gem = (rawGem ?? {}) as Record<string, unknown>
      // Abyss jewels sit in sockets too.
      if (gem.frameType !== GEM_FRAME && typeof gem.support !== 'boolean') continue
      const name = text(gem.typeLine) || text(gem.baseType)
      if (!name) continue
      const index = typeof gem.socket === 'number' ? gem.socket : -1
      const group = sockets[index]?.group
      const level = (Array.isArray(gem.properties) ? gem.properties : [])
        .map((entry) => entry as { name?: unknown; values?: unknown })
        .find((entry) => entry.name === 'Level')
      const levelText = Array.isArray(level?.values) ? text((level.values[0] as unknown[] | undefined)?.[0]) : ''
      socketed.push({
        name,
        support: gem.support === true,
        level: Number.parseInt(levelText, 10) || null,
        slot,
        // A gem whose socket the answer does not describe is alone in a group of its own.
        group: typeof group === 'number' ? group : 100 + socketed.length
      })
    }
  }
  return { socketed, loose }
}

/** Every name the build's gem may go by on the character: its own, the game's, the gem it is made from. */
function namesOf(gem: PobGem): Set<string> {
  return new Set([gem.name, gem.baseName ?? '', gem.id ? (GEMS[gem.id]?.name ?? '') : ''].filter(Boolean).map(plain))
}

function sourceHint(source: GemSource | undefined): string | null {
  if (!source) return null
  if (source.kind === 'start') return 'есть с самого начала'
  if (source.kind === 'quest') return `награда за «${source.quest}» у ${source.npc} (акт ${source.act})`
  return `купить у ${source.npc} после «${source.quest}» (акт ${source.act})`
}

export interface GemCheckContext {
  /** Skill sets whose gems are collected in the campaign, as indexes into `pob.skillSets`. */
  setIndexes: number[]
  gemSources: Record<string, GemSource>
  /** Index of the first route step not done yet. */
  position: number
  /** True once the campaign route is finished: every gem is obtainable then. */
  finished: boolean
  level: number
  character: string
  readAt: number
}

/**
 * Compares the gems of the build with what the character has. Of the selected skill sets the
 * one the character's gems match best is taken, since a build's sets replace each other as it
 * levels. A gem counts as due once the route passed the step that gives it and the character
 * can use it; due gems should be socketed, and the supports of a group linked to its skill.
 */
export function checkGems(pob: PobBuild, gems: CharacterGems, context: GemCheckContext): GemCheck | null {
  const socketedNames = gems.socketed.map((gem) => plain(gem.name))
  const looseNames = new Set(gems.loose.map(plain))
  const has = (gem: PobGem): boolean => [...namesOf(gem)].some((name) => socketedNames.includes(name))

  const sets = context.setIndexes.filter((index) => pob.skillSets[index]?.groups.some((group) => group.gems.length > 0))
  if (!sets.length) return null
  const score = (index: number): number => pob.skillSets[index].groups.flatMap((group) => group.gems).filter(has).length
  // The best match; among equals the earliest, which is the one a fresh character is on.
  const setIndex = sets.reduce((best, index) => (score(index) > score(best) ? index : best), sets[0])
  const set = pob.skillSets[setIndex]
  const linkSize = context.level >= FOUR_SOCKETS_FROM ? 4 : 3

  const missing: string[] = []
  const loose: string[] = []
  const unlinked: string[] = []
  const groups: GemGroupCheck[] = []
  // Each socketed gem answers for one gem of the build, so two copies need two sockets.
  const used = new Set<SocketedGem>()
  const find = (gem: PobGem, where?: (candidate: SocketedGem) => boolean): SocketedGem | undefined => {
    const names = namesOf(gem)
    const found = gems.socketed.find((candidate) => !used.has(candidate) && names.has(plain(candidate.name)) && (!where || where(candidate)))
    if (found) used.add(found)
    return found
  }

  for (const group of set.groups) {
    if (!group.gems.length) continue
    const main = group.gems.find((gem) => !gem.support) ?? null
    // The skill comes first: its place decides what the supports must be linked to.
    const ordered = main ? [main, ...group.gems.filter((gem) => gem !== main)] : group.gems
    let anchor: SocketedGem | undefined
    let linked = 0
    const states = new Map<PobGem, GemState>()
    for (const gem of ordered) {
      const data = gem.id ? GEMS[gem.id] : undefined
      const name = data?.name ?? gem.name
      const source = gem.id ? context.gemSources[gem.id] : undefined
      const obtainable = context.finished || (source !== undefined && (source.stepIndex ?? 0) < context.position)
      const usable = (data?.required_level ?? 1) <= context.level
      const state: GemState = { name, support: gem.support, state: 'later', hint: null }
      states.set(gem, state)

      const wantLink = main !== null && gem !== main && gem.support && anchor !== undefined
      const here = wantLink ? find(gem, (candidate) => candidate.slot === anchor!.slot && candidate.group === anchor!.group) : undefined
      const anywhere = here ?? find(gem)
      if (gem === main) anchor = anywhere

      if (anywhere) {
        const mustLink = wantLink && linked < linkSize - 1
        if (!wantLink || here) {
          state.state = 'linked'
          if (wantLink) linked++
        } else if (mustLink) {
          state.state = 'unlinked'
          state.hint = `не связан с ${main ? (GEMS[main.id ?? '']?.name ?? main.name) : 'скиллом'}`
          unlinked.push(`${name} не связан с ${main ? (GEMS[main.id ?? '']?.name ?? main.name) : 'скиллом'}`)
        } else {
          // More supports than the gear can link at this level: socketed is good enough.
          state.state = 'linked'
        }
      } else if ([...namesOf(gem)].some((candidate) => looseNames.has(candidate))) {
        state.state = usable ? 'loose' : 'later'
        state.hint = usable ? 'лежит в инвентаре, не вставлен' : `в инвентаре; нужен уровень ${data?.required_level}`
        if (usable) loose.push(`${name} лежит в инвентаре, не вставлен`)
      } else if (obtainable) {
        state.state = 'missing'
        state.hint = sourceHint(source) ?? 'в актах его уже можно было взять'
        missing.push(`Нет ${name}: ${state.hint}`)
      } else {
        state.hint = source ? `будет позже: ${sourceHint(source)}` : 'в актах его не взять и не купить'
      }
    }
    groups.push({ label: group.label || (main ? (GEMS[main.id ?? '']?.name ?? main.name) : 'Группа'), gems: group.gems.map((gem) => states.get(gem)!) })
  }

  return {
    setIndex,
    setTitle: set.title,
    groups,
    problems: [...unlinked, ...loose, ...missing].slice(0, PROBLEMS_SHOWN),
    character: context.character,
    readAt: context.readAt
  }
}
