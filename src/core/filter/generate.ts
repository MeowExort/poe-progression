import basesJson from '@data/vendor/pob/bases.json'
import type { FilterStage, FilterSummary } from '@shared/filter'
import type { CharacterClass, GemAttribute, PobBuild } from '@shared/plan'
import { GEMS } from '../route/data'

const BASES = basesJson as Record<string, { type: string; level: number; sub?: string }>

/**
 * The stages, by the level of the area the item drops in. The game applies the right one by
 * itself as the player moves on, so the file never has to be switched.
 */
const STAGES: Pick<FilterStage, 'id' | 'title' | 'from' | 'to'>[] = [
  { id: 'acts-early', title: 'Акты 1–5', from: 1, to: 44 },
  { id: 'acts-late', title: 'Акты 6–10', from: 45, to: 67 },
  { id: 'maps-white', title: 'Ранние карты (T1–5)', from: 68, to: 72 },
  { id: 'maps-yellow', title: 'Средние карты (T6–10)', from: 73, to: 77 },
  { id: 'maps-red', title: 'Красные карты (T11–16)', from: 78, to: 83 },
  { id: 'endgame', title: 'Эндгейм (T17 и выше)', from: 84, to: null }
]

/** Every class of weapon and off-hand; "One Hand" and "Two Hand" each cover three classes. */
const WEAPON_CLASSES = ['Claws', 'Daggers', 'Wands', 'One Hand', 'Two Hand', 'Bows', 'Staves', 'Sceptres', 'Quivers']
const ARMOUR_CLASSES = ['Gloves', 'Boots', 'Body Armours', 'Helmets', 'Shields']
const JEWELLERY_CLASSES = ['Amulets', 'Rings', 'Belts']

/** Path of Building's item types → the game's item classes. */
const WEAPON_CLASS: Record<string, string> = {
  'One Handed Axe': 'One Hand Axes',
  'One Handed Mace': 'One Hand Maces',
  'One Handed Sword': 'One Hand Swords',
  'Two Handed Axe': 'Two Hand Axes',
  'Two Handed Mace': 'Two Hand Maces',
  'Two Handed Sword': 'Two Hand Swords',
  Bow: 'Bows',
  Claw: 'Claws',
  Dagger: 'Daggers',
  Sceptre: 'Sceptres',
  Staff: 'Staves',
  Wand: 'Wands',
  Quiver: 'Quivers'
}
const ARMOUR_TYPES = new Set(['Body Armour', 'Boots', 'Gloves', 'Helmet', 'Shield'])

/** What a class usually wears, for a plan without items to read it from. */
const CLASS_DEFENCES: Record<CharacterClass, string[]> = {
  Marauder: ['Armour'],
  Ranger: ['Evasion'],
  Witch: ['Energy Shield'],
  Duelist: ['Armour/Evasion', 'Armour', 'Evasion'],
  Templar: ['Armour/Energy Shield', 'Armour', 'Energy Shield'],
  Shadow: ['Evasion/Energy Shield', 'Evasion', 'Energy Shield'],
  Scion: []
}

const SOCKET: Record<GemAttribute, string> = { strength: 'R', dexterity: 'G', intelligence: 'B', none: '' }

/** Price steps for highlighting, in chaos; the top one is a Divine Orb's worth when that is known. */
const PRICE_HIGH = 20
const PRICE_MID = 3
/** A filter line with thousands of names is slow to check: the cheap majority is left to the defaults. */
const PRICED_LIMIT = 600

export interface FilterInput {
  characterClass: CharacterClass | null
  pob: PobBuild | null
  /** Skill sets whose gems count, as indexes into `pob.skillSets`. */
  setIndexes: number[]
  /**
   * Whether to name the build's gems and the bases of its uniques in the file; on unless false.
   * The game refuses a file with a name it does not know, so this can be switched off.
   */
  buildNames?: boolean
  /** Chaos value by item name, from poe.ninja; null leaves price highlighting out. */
  prices: { chaosByName: Record<string, number>; divineChaos: number | null } | null
}

export interface GeneratedFilter {
  text: string
  stages: FilterStage[]
  summary: FilterSummary
}

const quote = (names: string[]): string => names.map((name) => `"${name}"`).join(' ')
/** Names go into the file in quotes: one with a quote or a line break in it would break the file. */
const safeName = (name: string): boolean => name.length > 0 && name.length < 80 && !/["\r\n]/.test(name)

/** One block of the filter. `when` holds conditions, `look` actions; empty lines are dropped. */
function block(kind: 'Show' | 'Hide', comment: string, when: (string | null)[], look: string[] = []): string {
  const lines = [...when, ...look].filter((line): line is string => !!line)
  return [`# ${comment}`, kind, ...lines.map((line) => `    ${line}`)].join('\n')
}

/** The conditions that pick out armour of one defence type, e.g. "Armour/Evasion". */
function defenceConditions(defence: string): string[] {
  const has = new Set(defence.split('/'))
  return [
    `BaseArmour ${has.has('Armour') ? '>' : '='} 0`,
    `BaseEvasion ${has.has('Evasion') ? '>' : '='} 0`,
    `BaseEnergyShield ${has.has('Energy Shield') ? '>' : '='} 0`
  ]
}

interface BuildFacts {
  weaponClasses: string[]
  defences: string[]
  links: string[]
  gems: string[]
  uniqueBases: string[]
}

function readBuild(input: FilterInput): BuildFacts {
  const weaponClasses = new Set<string>()
  const defences = new Set<string>()
  const uniqueBases = new Set<string>()
  for (const item of input.pob?.itemSets.flatMap((set) => set.items) ?? []) {
    const base = item.base ? BASES[item.base] : undefined
    if (!item.base || !base) continue
    if (item.rarity === 'UNIQUE' || item.rarity === 'RELIC') {
      if (safeName(item.base)) uniqueBases.add(item.base)
      // A unique says nothing about what rare gear the build wears.
      continue
    }
    if (WEAPON_CLASS[base.type]) weaponClasses.add(WEAPON_CLASS[base.type])
    if (ARMOUR_TYPES.has(base.type) && base.sub && base.sub !== 'Ward') defences.add(base.sub)
  }
  if (!defences.size && input.characterClass) for (const defence of CLASS_DEFENCES[input.characterClass]) defences.add(defence)

  // The colours of the build's gem groups that have supports: three and four of them linked.
  const links = new Set<string>()
  const gems = new Set<string>()
  for (const index of input.setIndexes) {
    for (const group of input.pob?.skillSets[index]?.groups ?? []) {
      for (const gem of group.gems) {
        // Only gems the game data knows by this exact name: an unknown name would make the
        // game refuse the whole file.
        const name = gem.id ? GEMS[gem.id]?.name : undefined
        if (name && safeName(name)) gems.add(name)
      }
      if (!group.gems.some((gem) => gem.support) || !group.gems.some((gem) => !gem.support)) continue
      const ordered = [...group.gems.filter((gem) => !gem.support).slice(0, 1), ...group.gems.filter((gem) => gem.support)]
      for (const size of [3, 4]) {
        const colours = ordered.slice(0, size).map((gem) => SOCKET[gem.attribute]).filter(Boolean).sort().join('')
        if (colours.length >= 2 && ordered.length >= size) links.add(colours)
      }
    }
  }
  const named = input.buildNames !== false
  return {
    weaponClasses: [...weaponClasses].sort(),
    defences: [...defences].sort(),
    links: [...links].sort((a, b) => a.length - b.length || a.localeCompare(b)).slice(0, 8),
    gems: named ? [...gems].sort() : [],
    uniqueBases: named ? [...uniqueBases].sort() : []
  }
}

/** Items worth highlighting by price, most valuable first, in three steps. */
function pricedTiers(prices: FilterInput['prices']): { top: string[]; high: string[]; mid: string[] } {
  const tiers = { top: [] as string[], high: [] as string[], mid: [] as string[] }
  if (!prices) return tiers
  const top = Math.max(prices.divineChaos ?? 0, 100)
  const entries = Object.entries(prices.chaosByName)
    .filter(([name, chaos]) => safeName(name) && Number.isFinite(chaos) && chaos >= PRICE_MID)
    .sort((a, b) => b[1] - a[1])
    .slice(0, PRICED_LIMIT)
  for (const [name, chaos] of entries) (chaos >= top ? tiers.top : chaos >= PRICE_HIGH ? tiers.high : tiers.mid).push(name)
  for (const names of Object.values(tiers)) names.sort()
  return tiers
}

const TOP_LOOK = [
  'SetFontSize 45',
  'SetTextColor 255 0 0 255',
  'SetBorderColor 255 0 0 255',
  'SetBackgroundColor 255 255 255 255',
  'PlayAlertSound 6 300',
  'PlayEffect Red',
  'MinimapIcon 0 Red Star'
]
const HIGH_LOOK = [
  'SetFontSize 42',
  'SetTextColor 255 255 255 255',
  'SetBorderColor 255 255 255 255',
  'SetBackgroundColor 200 90 0 255',
  'PlayAlertSound 1 300',
  'PlayEffect Yellow',
  'MinimapIcon 1 Yellow Circle'
]
const MID_LOOK = ['SetFontSize 38', 'SetBorderColor 200 160 60 255', 'SetBackgroundColor 60 45 15 240', 'MinimapIcon 2 Yellow Circle']
const BUILD_LOOK = ['SetFontSize 40', 'SetBorderColor 80 220 120 255', 'SetBackgroundColor 15 50 30 240', 'MinimapIcon 2 Green Diamond']
const BASE_LOOK = ['SetFontSize 36', 'SetBorderColor 120 170 230 255', 'SetBackgroundColor 20 35 60 230']
const QUIET_LOOK = ['SetFontSize 30']

/**
 * Writes the loot filter for a build. Nothing but normal, magic and rare gear and flasks is
 * ever hidden: currency, maps, fragments, cards, uniques, gems, jewels and anything this file
 * does not know about fall through to the last block, which shows them.
 */
export function generateFilter(input: FilterInput): GeneratedFilter {
  const facts = readBuild(input)
  const priced = pricedTiers(input.prices)
  const gear = [...WEAPON_CLASSES, ...ARMOUR_CLASSES]
  const buildWeapons = facts.weaponClasses.length ? facts.weaponClasses : null
  const blocks: string[] = []
  const add = (...args: Parameters<typeof block>): void => void blocks.push(block(...args))

  /** One block per defence type the build wears; or one for all armour when that is unknown. */
  const forBuildArmour = (comment: string, when: string[], look: string[]): void => {
    if (!facts.defences.length) return add('Show', comment, [`Class ${quote(ARMOUR_CLASSES)}`, ...when], look)
    for (const defence of facts.defences) {
      add('Show', `${comment} (${defence})`, [`Class ${quote(ARMOUR_CLASSES)}`, ...defenceConditions(defence), ...when], look)
    }
  }
  const forBuildWeapons = (comment: string, when: string[], look: string[]): void => {
    if (buildWeapons) add('Show', comment, [`Class ${quote(buildWeapons)}`, ...when], look)
  }

  // ── Always worth a look, whatever the stage ──
  add('Show', 'Six linked sockets', ['LinkedSockets 6'], TOP_LOOK)
  add('Show', 'Five linked sockets', ['LinkedSockets 5', 'Rarity <= Rare'], HIGH_LOOK)
  add('Show', 'Six sockets: Jeweller\'s Orbs from a vendor', ['Sockets >= 6', 'Rarity <= Rare'], MID_LOOK)
  add('Show', 'Influenced, fractured and synthesised gear', ['HasInfluence Shaper Elder Crusader Hunter Redeemer Warlord', 'Rarity <= Rare'], BASE_LOOK)
  add('Show', 'Fractured gear', ['FracturedItem True', 'Rarity <= Rare'], BASE_LOOK)
  add('Show', 'Synthesised gear', ['SynthesisedItem True', 'Rarity <= Rare'], BASE_LOOK)

  if (priced.top.length) add('Show', 'Worth a Divine Orb or more (poe.ninja)', [`BaseType == ${quote(priced.top)}`], TOP_LOOK)
  if (priced.high.length) add('Show', `Worth ${PRICE_HIGH} chaos or more (poe.ninja)`, [`BaseType == ${quote(priced.high)}`], HIGH_LOOK)
  if (priced.mid.length) add('Show', `Worth ${PRICE_MID} chaos or more (poe.ninja)`, [`BaseType == ${quote(priced.mid)}`], MID_LOOK)

  if (facts.uniqueBases.length) {
    add('Show', 'Uniques on the bases of the build\'s uniques', ['Rarity Unique', `BaseType == ${quote(facts.uniqueBases)}`], [
      ...BUILD_LOOK,
      'PlayAlertSound 3 300',
      'PlayEffect Green'
    ])
  }
  add('Show', 'Every other unique', ['Rarity Unique'], ['SetFontSize 40', 'SetBorderColor 175 96 37 255', 'MinimapIcon 2 Brown Star', 'PlayAlertSound 3 200'])
  if (facts.gems.length) add('Show', 'Gems of the build', ['Class "Gems"', `BaseType == ${quote(facts.gems)}`], BUILD_LOOK)

  // ── Levelling: links for the build's skills ──
  if (facts.links.length) {
    const three = facts.links.filter((link) => link.length <= 3)
    const four = facts.links.filter((link) => link.length === 4)
    if (three.length) add('Show', 'Three links in the build\'s colours', [`SocketGroup ${quote(three)}`, 'Rarity <= Rare', 'AreaLevel <= 33'], BUILD_LOOK)
    if (four.length) add('Show', 'Four links in the build\'s colours', [`SocketGroup ${quote(four)}`, 'LinkedSockets >= 4', 'Rarity <= Rare', 'AreaLevel <= 67'], BUILD_LOOK)
  }
  add('Show', 'Any three links early on', ['LinkedSockets >= 3', 'Rarity <= Rare', 'AreaLevel <= 24'], QUIET_LOOK)
  add('Show', 'Any four links through the campaign', ['LinkedSockets >= 4', 'Rarity <= Rare', 'AreaLevel <= 67'], QUIET_LOOK)
  add('Show', 'Red-green-blue links: a Chromatic Orb from a vendor', ['SocketGroup "RGB"', 'Rarity <= Rare', 'AreaLevel <= 77'], QUIET_LOOK)

  // ── Jewellery ──
  add('Show', 'Rare jewellery, always', [`Class ${quote(JEWELLERY_CLASSES)}`, 'Rarity Rare'], BASE_LOOK)
  add('Show', 'Magic jewellery through the campaign', [`Class ${quote(JEWELLERY_CLASSES)}`, 'Rarity Magic', 'AreaLevel <= 67'])
  add('Show', 'Normal jewellery in the first three acts', [`Class ${quote(JEWELLERY_CLASSES)}`, 'Rarity Normal', 'AreaLevel <= 33'])
  add('Show', 'Jewellery to craft on: item level 84 and up', [`Class ${quote(JEWELLERY_CLASSES)}`, 'Rarity <= Magic', 'ItemLevel >= 84'], BASE_LOOK)
  add('Hide', 'Other normal and magic jewellery', [`Class ${quote(JEWELLERY_CLASSES)}`, 'Rarity <= Magic'], ['SetFontSize 18'])

  // ── Flasks ──
  add('Show', 'Flasks with quality: Glassblower\'s Baubles from a vendor', ['Class "Flasks"', 'Quality >= 10'], QUIET_LOOK)
  add('Show', 'Every flask in the first acts', ['Class "Flasks"', 'AreaLevel <= 44'])
  add('Show', 'Utility flasks until red maps', ['Class "Utility Flasks"', 'AreaLevel <= 77'])
  add('Show', 'Bigger life and mana flasks in the late acts', ['Class "Life Flasks" "Mana Flasks" "Hybrid Flasks"', 'DropLevel >= 30', 'AreaLevel <= 67'])
  add('Hide', 'Other flasks', ['Class "Flasks"', 'Rarity <= Rare'], ['SetFontSize 18'])

  // ── Rare gear ──
  forBuildWeapons('Rare weapons of the build\'s classes while levelling', ['Rarity Rare', 'AreaLevel <= 67'], BUILD_LOOK)
  forBuildArmour('Rare armour of the build\'s kind while levelling', ['Rarity Rare', 'AreaLevel <= 67'], BUILD_LOOK)
  add('Show', 'Every rare during the campaign', [`Class ${quote(gear)}`, 'Rarity Rare', 'AreaLevel <= 67'])
  forBuildWeapons('Rare weapons of the build\'s classes in maps, good bases', ['Rarity Rare', 'DropLevel >= 50'], BUILD_LOOK)
  forBuildArmour('Rare armour of the build\'s kind in maps, good bases', ['Rarity Rare', 'DropLevel >= 50'], BUILD_LOOK)
  add('Show', 'Other rares in white maps, unless the base is a levelling one', [`Class ${quote(gear)}`, 'Rarity Rare', 'DropLevel >= 45', 'AreaLevel <= 72'])
  add('Show', 'Other rares in yellow maps, on late bases only', [`Class ${quote(gear)}`, 'Rarity Rare', 'DropLevel >= 55', 'AreaLevel <= 77'])

  // ── Magic and normal gear ──
  add('Show', 'Every magic item in the first three acts', [`Class ${quote(gear)}`, 'Rarity Magic', 'AreaLevel <= 33'])
  forBuildWeapons('Magic weapons of the build\'s classes in acts 4 and 5', ['Rarity Magic', 'AreaLevel <= 44'], [])
  forBuildArmour('Magic armour of the build\'s kind in acts 4 and 5', ['Rarity Magic', 'AreaLevel <= 44'], [])
  add('Show', 'Every normal item in act 1', [`Class ${quote(gear)}`, 'Rarity Normal', 'AreaLevel <= 12'])
  forBuildWeapons('Bases to craft on: the build\'s weapons, item level 84 and up', ['Rarity <= Magic', 'ItemLevel >= 84', 'DropLevel >= 60', 'AreaLevel >= 78'], BASE_LOOK)
  forBuildArmour('Bases to craft on: the build\'s armour, item level 84 and up', ['Rarity <= Magic', 'ItemLevel >= 84', 'DropLevel >= 60', 'AreaLevel >= 78'], BASE_LOOK)

  add('Hide', 'The rest of normal, magic and rare weapons and armour', [`Class ${quote(gear)}`, 'Rarity <= Rare'], ['SetFontSize 18'])

  // ── Everything else is shown ──
  add('Show', 'Currency: a little bigger than the default', ['Class "Currency"'], ['SetFontSize 36', 'SetBorderColor 170 158 130 200'])
  add('Show', 'Maps, fragments, cards, gems, jewels and whatever this file does not know', [])

  const header = [
    '# PoE Progression: a loot filter made for your build.',
    '# The file is rewritten by the app: edits made by hand will be lost.',
    '# Stages follow the area level, so there is nothing to switch as you progress:',
    ...STAGES.map((stage) => `#   ${stage.id}: area level ${stage.from}${stage.to === null ? '+' : `-${stage.to}`}`),
    `# Build: ${facts.weaponClasses.join(', ') || 'weapons unknown'}; ${facts.defences.join(', ') || 'armour unknown'}; links ${facts.links.join(', ') || 'unknown'}.`
  ].join('\n')

  return {
    text: `${header}\n\n${blocks.join('\n\n')}\n`,
    stages: describeStages(facts),
    summary: {
      weaponClasses: facts.weaponClasses,
      defences: facts.defences,
      links: facts.links,
      gems: facts.gems.length,
      uniqueBases: facts.uniqueBases.length,
      priced: priced.top.length + priced.high.length + priced.mid.length
    }
  }
}

function describeStages(facts: BuildFacts): FilterStage[] {
  const mine = facts.weaponClasses.length || facts.defences.length ? 'под билд' : 'любые'
  const text: Record<FilterStage['id'], { shows: string[]; hides: string[] }> = {
    'acts-early': {
      shows: [
        'все редкие вещи; подходящие билду подсвечены',
        'все синие вещи до конца 3 акта, в 4–5 актах — только под билд',
        'белые вещи в 1 акте',
        'связки из трёх (до 3 акта) и из четырёх; в цветах билда подсвечены',
        'все фласки; вся бижутерия (белая — до конца 3 акта)'
      ],
      hides: ['белые вещи без связок после 1 акта', 'синие вещи не под билд в 4–5 актах']
    },
    'acts-late': {
      shows: [
        'все редкие вещи; подходящие билду подсвечены',
        'связки из четырёх; в цветах билда подсвечены',
        'редкая и синяя бижутерия, фласки жизни и маны от Colossal и выше, утилитарные фласки'
      ],
      hides: ['белые и синие вещи', 'мелкие фласки', 'белая бижутерия']
    },
    'maps-white': {
      shows: [`редкие вещи ${mine} на базах от 50-го уровня`, 'прочие редкие вещи на базах от 45-го уровня', 'редкая бижутерия, утилитарные фласки'],
      hides: ['редкие вещи на базах для прокачки', 'белые и синие вещи', 'фласки жизни и маны']
    },
    'maps-yellow': {
      shows: [`редкие вещи ${mine} на базах от 50-го уровня`, 'прочие редкие вещи на базах от 55-го уровня', 'редкая бижутерия, утилитарные фласки'],
      hides: ['редкие вещи на базах ниже 55-го уровня', 'белые и синие вещи', 'фласки жизни и маны']
    },
    'maps-red': {
      shows: [
        `редкие вещи ${mine} на базах от 50-го уровня`,
        'белые и синие базы под билд с уровнем предмета 84+ — под крафт',
        'редкая бижутерия; белая и синяя — с уровнем предмета 84+'
      ],
      hides: ['редкие вещи не под билд', 'все фласки без качества']
    },
    endgame: {
      shows: [
        `редкие вещи ${mine} на базах от 50-го уровня`,
        'белые и синие базы под билд с уровнем предмета 84+ — под крафт',
        'редкая бижутерия; белая и синяя — с уровнем предмета 84+'
      ],
      hides: ['редкие вещи не под билд', 'все фласки без качества']
    }
  }
  return STAGES.map((stage) => ({ ...stage, ...text[stage.id] }))
}
