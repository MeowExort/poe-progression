import { inflateSync } from 'node:zlib'
import { XMLParser } from 'fast-xml-parser'
import { AWAKENED_GEMS, GEMS, VAAL_GEMS } from '@core/route/data'
import {
  CHARACTER_CLASSES,
  type Bandit,
  type CharacterClass,
  type PobBuild,
  type PobGem,
  type PobItem,
  type PobItemSet,
  type PobSkillGroup,
  type PobSkillSet,
  type PobTreeSpec
} from '@shared/plan'

/** A build export is a few hundred kilobytes of XML at most; anything far bigger is not one. */
const MAX_XML_BYTES = 20 * 1024 * 1024

/** Gem ids Path of Building writes differently from the game data (list from exile-leveling). */
const GEM_ID_REMAP: Record<string, string> = {
  'Metadata/Items/Gems/Smite': 'Metadata/Items/Gems/SkillGemSmite',
  'Metadata/Items/Gems/ConsecratedPath': 'Metadata/Items/Gems/SkillGemConsecratedPath',
  'Metadata/Items/Gems/VaalAncestralWarchief': 'Metadata/Items/Gems/SkillGemVaalAncestralWarchief',
  'Metadata/Items/Gems/HeraldOfAgony': 'Metadata/Items/Gems/SkillGemHeraldOfAgony',
  'Metadata/Items/Gems/HeraldOfPurity': 'Metadata/Items/Gems/SkillGemHeraldOfPurity',
  'Metadata/Items/Gems/ScourgeArrow': 'Metadata/Items/Gems/SkillGemScourgeArrow',
  'Metadata/Items/Gems/RainOfSpores': 'Metadata/Items/Gems/SkillGemToxicRain',
  'Metadata/Items/Gems/SummonRelic': 'Metadata/Items/Gems/SkillGemSummonRelic',
  'Metadata/Items/Gems/SkillGemNewPhaseRun': 'Metadata/Items/Gems/SkillGemPhaseRun',
  'Metadata/Items/Gems/SkillGemNewArcticArmour': 'Metadata/Items/Gems/SkillGemArcticArmour'
}

const BANDITS: Record<string, Bandit> = { None: 'kill', Alira: 'alira', Oak: 'oak', Kraityn: 'kraityn' }

export class PobError extends Error {}

type Node = Record<string, unknown>

const ARRAY_TAGS = new Set(['SkillSet', 'Skill', 'Gem', 'Spec', 'Item', 'ItemSet', 'Slot'])

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  textNodeName: 'text',
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: false,
  isArray: (name) => ARRAY_TAGS.has(name)
})

/** Decodes a Path of Building export code (URL-safe base64 of zlib-compressed XML) into the XML. */
export function decodePobCode(code: string): string {
  const compact = code.replace(/\s+/g, '')
  if (!compact) throw new PobError('Пустой код.')
  if (/^https?:/i.test(compact)) {
    throw new PobError('Это ссылка, а нужен сам код: в Path of Building открой Import/Export Build → Generate и скопируй его.')
  }
  if (!/^[A-Za-z0-9+/_=-]+$/.test(compact)) throw new PobError('Это не похоже на код Path of Building.')
  try {
    const bytes = Buffer.from(compact.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
    return inflateSync(bytes, { maxOutputLength: MAX_XML_BYTES }).toString('utf8')
  } catch {
    throw new PobError('Код не распаковывается: возможно, он скопирован не целиком.')
  }
}

export function parsePobCode(code: string): PobBuild {
  return parsePobXml(decodePobCode(code))
}

export function parsePobXml(xml: string): PobBuild {
  let root: Node | undefined
  try {
    root = (parser.parse(xml) as Node).PathOfBuilding as Node | undefined
  } catch {
    root = undefined
  }
  if (!root) throw new PobError('Внутри кода нет билда Path of Building.')

  const build = (root.Build ?? {}) as Node
  const className = str(build.className)
  const level = Number.parseInt(str(build.level) ?? '', 10)

  return {
    className: CHARACTER_CLASSES.includes(className as CharacterClass) ? (className as CharacterClass) : null,
    ascendancy: nonEmpty(str(build.ascendClassName), 'None'),
    level: Number.isFinite(level) ? level : null,
    bandit: BANDITS[str(build.bandit) ?? 'None'] ?? 'kill',
    skillSets: parseSkills((root.Skills ?? {}) as Node),
    treeSpecs: list((root.Tree as Node | undefined)?.Spec).map(parseSpec),
    itemSets: parseItems((root.Items ?? {}) as Node),
    notes: cleanText(text(root.Notes)).trim()
  }
}

function parseSkills(skills: Node): PobSkillSet[] {
  const sets = list(skills.SkillSet)
  // Old exports have no skill sets: the groups sit directly under <Skills>.
  const sources = sets.length ? sets : [skills]
  return sources
    .map((set, i): PobSkillSet => {
      const groups: PobSkillGroup[] = []
      // Authors use an empty labelled group as a heading for the groups below it.
      let heading: string | null = null
      for (const skill of list(set.Skill)) {
        if (str(skill.enabled) === 'false') continue
        // Skills granted by an item are not gems the player has to find.
        if (str(skill.source)) continue
        const label = cleanText(str(skill.label) ?? '').trim()
        const gems = list(skill.Gem)
          .filter((gem) => str(gem.enabled) !== 'false')
          .map(parseGem)
        if (!gems.length) {
          if (label) heading = label
          continue
        }
        const mainGem = gems.find((gem) => !gem.support) ?? gems[0]
        groups.push({ label: label || heading || mainGem.name, slot: nonEmpty(str(skill.slot)), gems })
      }
      return { title: cleanText(str(set.title) ?? '').trim() || `Набор ${i + 1}`, groups }
    })
    .filter((set) => set.groups.length > 0)
}

function parseGem(gem: Node): PobGem {
  const name = str(gem.nameSpec) ?? str(gem.skillId) ?? '?'
  const id = resolveGemId(str(gem.gemId), name)
  const data = id ? GEMS[id] : undefined
  const level = Number.parseInt(str(gem.level) ?? '', 10)
  return {
    id,
    name,
    baseName: data && !sameGemName(data.name, name) ? data.name : null,
    level: Number.isFinite(level) ? level : 1,
    attribute: data?.primary_attribute ?? 'none',
    support: data?.is_support ?? /Support/i.test(str(gem.gemId) ?? '')
  }
}

function resolveGemId(rawId: string | null, name: string): string | null {
  if (rawId) {
    let id = GEM_ID_REMAP[rawId] ?? rawId
    id = VAAL_GEMS[id] ?? id
    id = AWAKENED_GEMS[id] ?? id
    if (GEMS[id]) return id
  }
  // Exports without usable ids: fall back to the name ("Added Fire Damage" is "… Support" in game data).
  const wanted = name.toLowerCase()
  const byName = Object.values(GEMS).find((gem) => {
    const candidate = gem.name.toLowerCase()
    return candidate === wanted || candidate === `${wanted} support`
  })
  return byName?.id ?? null
}

function sameGemName(dataName: string, pobName: string): boolean {
  const strip = (value: string): string => value.toLowerCase().replace(/ support$/, '')
  return strip(dataName) === strip(pobName)
}

function parseSpec(spec: Node, i: number): PobTreeSpec {
  const nodes = (str(spec.nodes) ?? '').split(',').filter((node) => node.trim().length > 0).length
  const url = text(spec.URL).trim()
  return {
    title: cleanText(str(spec.title) ?? '').trim() || `Дерево ${i + 1}`,
    url: /^https:\/\//.test(url) ? url : null,
    nodes
  }
}

const INFLUENCE_LINE = /^(Shaper|Elder|Crusader|Redeemer|Hunter|Warlord|Searing Exarch|Eater of Worlds) Item$/

function parseItems(items: Node): PobItemSet[] {
  const byId = new Map<string, Omit<PobItem, 'slot'>>()
  for (const item of list(items.Item)) {
    const id = str(item.id)
    const parsed = parseItemText(text(item))
    if (id && parsed) byId.set(id, parsed)
  }

  const sets = list(items.ItemSet)
  const sources = sets.length ? sets : [items]
  return sources
    .map((set, i): PobItemSet => {
      const equipped: PobItem[] = []
      for (const slot of list(set.Slot)) {
        const item = byId.get(str(slot.itemId) ?? '')
        const name = str(slot.name)
        if (item && name) equipped.push({ slot: name, ...item })
      }
      return { title: cleanText(str(set.title) ?? '').trim() || `Набор ${i + 1}`, items: equipped }
    })
    .filter((set) => set.items.length > 0)
}

/** An item is stored as the text you get from Ctrl+C in game: rarity, name, base type, mods. */
function parseItemText(raw: string): Omit<PobItem, 'slot'> | null {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const rarityIndex = lines.findIndex((line) => /^Rarity:/i.test(line))
  if (rarityIndex === -1 || !lines[rarityIndex + 1]) return null
  const rarity = lines[rarityIndex].replace(/^Rarity:\s*/i, '').toUpperCase()
  const name = lines[rarityIndex + 1]
  const next = lines[rarityIndex + 2]
  // Rare and unique items have a name line followed by the base type; a "Key: value" line is a property.
  const named = rarity === 'RARE' || rarity === 'UNIQUE' || rarity === 'RELIC'

  let links = 0
  const influences: string[] = []
  const craftedMods: string[] = []
  let fractured = false
  let corrupted = false
  for (const line of lines) {
    const sockets = /^Sockets:\s*(.+)$/.exec(line)
    if (sockets) {
      // "R-G-B B-B": dashes link sockets, spaces separate the linked groups.
      links = Math.max(...sockets[1].split(/\s+/).map((group) => group.split('-').length))
      continue
    }
    const influence = INFLUENCE_LINE.exec(line)
    if (influence) influences.push(influence[1])
    if (line === 'Corrupted') corrupted = true
    // Mod lines carry tags in braces before the text: "{crafted}{range:0.5}+(10-15)% to Fire Resistance".
    const tags = /^(?:\{[^}]*\})+/.exec(line)?.[0] ?? ''
    if (tags.includes('{fractured}')) fractured = true
    if (tags.includes('{crafted}')) craftedMods.push(line.slice(tags.length).trim())
  }

  return {
    rarity,
    name,
    base: named && next && !next.includes(':') ? next : null,
    links,
    influences,
    craftedMods,
    fractured,
    corrupted
  }
}

/** Removes Path of Building colour codes such as ^7 and ^xFFAA00. */
function cleanText(value: string): string {
  return value.replace(/\^(x[0-9a-fA-F]{6}|[0-9])/g, '')
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function nonEmpty(value: string | null, placeholder?: string): string | null {
  return value && value !== placeholder ? value : null
}

function list(value: unknown): Node[] {
  return Array.isArray(value) ? (value.filter((item) => item && typeof item === 'object') as Node[]) : []
}

/** Text content of an element, whether the parser kept it as a string or under `text`. */
function text(value: unknown): string {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object') return str((value as Node).text) ?? ''
  return ''
}
