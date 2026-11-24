import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { generateFilter, type FilterInput } from '../src/core/filter/generate'
import { FilterWriter } from '../src/main/filter'
import type { FilterView } from '../src/shared/filter'
import type { PobBuild, PobGem, PobItem } from '../src/shared/plan'

const G = 'Metadata/Items/Gems/'
const gem = (name: string, id: string | null, attribute: PobGem['attribute'], support: boolean): PobGem => ({
  id,
  name,
  baseName: null,
  level: 1,
  attribute,
  support
})
const item = (slot: string, name: string, base: string, rarity = 'RARE'): PobItem => ({
  slot,
  name,
  base,
  rarity,
  links: 0,
  influences: [],
  craftedMods: [],
  fractured: false,
  corrupted: false,
  itemLevel: null,
  mods: []
})

const pob: PobBuild = {
  className: 'Ranger',
  ascendancy: 'Deadeye',
  level: 90,
  bandit: 'kill',
  skillSets: [
    {
      title: 'Main',
      groups: [
        {
          label: 'Bow',
          slot: null,
          gems: [
            gem('Toxic Rain', `${G}SkillGemToxicRain`, 'dexterity', false),
            gem('Mirage Archer', `${G}SupportGemMirageArcher`, 'dexterity', true),
            gem('Void Manipulation', `${G}SupportGemVoidManipulation`, 'dexterity', true),
            gem('Efficacy', `${G}SupportGemEfficacy`, 'intelligence', true),
            gem('Made Up "Gem"', null, 'strength', true)
          ]
        },
        { label: 'Auras', slot: null, gems: [gem('Grace', `${G}SkillGemGrace`, 'dexterity', false)] }
      ]
    }
  ],
  treeSpecs: [],
  notes: '',
  itemSets: [
    {
      title: 'Maps',
      items: [
        item('Weapon 1', 'Doom Thirst', 'Thicket Bow'),
        item('Body Armour', 'Rage Shell', 'Zodiac Leather'),
        item('Gloves', 'Grip', 'Sharkskin Gloves'),
        item('Helmet', "Hyrri's Ire", 'Zodiac Leather', 'UNIQUE'),
        item('Ring 1', 'Unknown thing', 'Not A Real Base')
      ]
    }
  ]
}

const input: FilterInput = {
  characterClass: 'Ranger',
  pob,
  setIndexes: [0],
  prices: { divineChaos: 200, chaosByName: { 'Divine Orb': 200, 'Mirror of Kalandra': 90000, 'Chaos Orb': 1, 'Volatile Vaal Orb': 640, 'Orb of Annulment': 25, 'Vaal Orb': 4, 'Bad "Name"': 500 } }
}

const KEYWORDS = new Set([
  'Class', 'BaseType', 'Rarity', 'ItemLevel', 'DropLevel', 'AreaLevel', 'Sockets', 'LinkedSockets', 'SocketGroup', 'Quality',
  'HasInfluence', 'FracturedItem', 'SynthesisedItem', 'BaseArmour', 'BaseEvasion', 'BaseEnergyShield',
  'SetFontSize', 'SetTextColor', 'SetBorderColor', 'SetBackgroundColor', 'PlayAlertSound', 'PlayEffect', 'MinimapIcon'
])

/** Splits the file into blocks and checks it is something the game can parse. */
function parse(text: string): { kind: string; comment: string; lines: string[] }[] {
  const blocks: { kind: string; comment: string; lines: string[] }[] = []
  let comment = ''
  for (const line of text.split('\n')) {
    if (line.startsWith('#')) comment = line.slice(1).trim()
    else if (line === 'Show' || line === 'Hide') blocks.push({ kind: line, comment, lines: [] })
    else if (line.trim()) {
      expect(line.startsWith('    '), line).toBe(true)
      expect(blocks.length, line).toBeGreaterThan(0)
      blocks[blocks.length - 1].lines.push(line.trim())
    }
  }
  return blocks
}

describe('generateFilter', () => {
  const { text, stages, summary } = generateFilter(input)
  const blocks = parse(text)
  const find = (comment: RegExp) => blocks.filter((entry) => comment.test(entry.comment))

  it('writes only what the game understands', () => {
    expect(text).toMatch(/^[\x20-\x7E\n]*$/)
    expect(blocks.length).toBeGreaterThan(30)
    for (const entry of blocks) {
      for (const line of entry.lines) {
        const keyword = line.split(' ')[0]
        expect(KEYWORDS.has(keyword), line).toBe(true)
        expect((line.match(/"/g) ?? []).length % 2, line).toBe(0)
        if (/^Set(Text|Border|Background)Color/.test(line)) expect(line).toMatch(/Color( \d{1,3}){4}$/)
        if (keyword === 'SetFontSize') expect(+line.split(' ')[1]).toBeGreaterThanOrEqual(18)
        if (keyword === 'SetFontSize') expect(+line.split(' ')[1]).toBeLessThanOrEqual(45)
        if (['ItemLevel', 'DropLevel', 'AreaLevel', 'Sockets', 'Quality'].includes(keyword)) expect(line).toMatch(/ (<=|>=|=|<|>) \d+$/)
      }
    }
  })

  it('hides nothing but normal, magic and rare gear, jewellery and flasks', () => {
    const hidden = blocks.filter((entry) => entry.kind === 'Hide')
    expect(hidden).toHaveLength(3)
    for (const entry of hidden) {
      expect(entry.lines.some((line) => line.startsWith('Class ')), entry.comment).toBe(true)
      expect(entry.lines.some((line) => /^Rarity <= (Rare|Magic)$/.test(line)), entry.comment).toBe(true)
      expect(entry.lines.join(' ')).not.toMatch(/Currency|Maps|Gems|Jewels|Cards/)
    }
    // The last block shows whatever nothing above matched.
    expect(blocks.at(-1)).toMatchObject({ kind: 'Show', lines: [] })
  })

  it('reads the build: weapons, armour, link colours, gems and unique bases', () => {
    expect(summary).toEqual({ weaponClasses: ['Bows'], defences: ['Evasion'], links: ['GGG', 'BGGG'], gems: 5, uniqueBases: 1, priced: 5 })
    const [weapons] = find(/Rare weapons of the build's classes while levelling/)
    expect(weapons.lines).toContain('Class "Bows"')
    const [armour] = find(/Rare armour of the build's kind while levelling/)
    expect(armour.lines).toEqual(expect.arrayContaining(['BaseArmour = 0', 'BaseEvasion > 0', 'BaseEnergyShield = 0']))
    expect(find(/Four links in the build's colours/)[0].lines).toContain('SocketGroup "BGGG"')
    expect(find(/Gems of the build/)[0].lines[1]).toContain('"Toxic Rain"')
    expect(find(/Uniques on the bases/)[0].lines).toContain('BaseType == "Zodiac Leather"')
  })

  it('never writes a name it is not sure of', () => {
    expect(text).not.toContain('Made Up')
    expect(text).not.toContain('Not A Real Base')
    expect(text).not.toContain('Bad ')
  })

  it('highlights by price in three steps', () => {
    expect(find(/Divine Orb or more/)[0].lines[0]).toBe('BaseType == "Divine Orb" "Mirror of Kalandra" "Volatile Vaal Orb"')
    expect(find(/Worth 20 chaos/)[0].lines[0]).toBe('BaseType == "Orb of Annulment"')
    expect(find(/Worth 3 chaos/)[0].lines[0]).toBe('BaseType == "Vaal Orb"')
    expect(generateFilter({ ...input, prices: null }).text).not.toContain('poe.ninja')
  })

  it('can leave out every name taken from the build', () => {
    const plain = generateFilter({ ...input, buildNames: false })
    expect(plain.summary).toMatchObject({ gems: 0, uniqueBases: 0, links: ['GGG', 'BGGG'], weaponClasses: ['Bows'] })
    expect(plain.text).not.toContain('Toxic Rain')
    expect(plain.text).not.toContain('Zodiac Leather')
  })

  it('gets stricter stage by stage', () => {
    expect(stages.map((stage) => `${stage.id} ${stage.from}-${stage.to}`)).toEqual([
      'acts-early 1-44', 'acts-late 45-67', 'maps-white 68-72', 'maps-yellow 73-77', 'maps-red 78-83', 'endgame 84-null'
    ])
    for (const stage of stages) expect(stage.shows.length && stage.hides.length).toBeTruthy()
    // Rares off the build stop being shown after yellow maps.
    const others = find(/Other rares in/)
    expect(others.map((entry) => entry.lines.find((line) => line.startsWith('AreaLevel')))).toEqual(['AreaLevel <= 72', 'AreaLevel <= 77'])
    expect(others.map((entry) => entry.lines.find((line) => line.startsWith('DropLevel')))).toEqual(['DropLevel >= 45', 'DropLevel >= 55'])
  })

  it('works without a build: nothing is highlighted as "for the build", every stage still applies', () => {
    const plain = generateFilter({ characterClass: null, pob: null, setIndexes: [], prices: null })
    expect(plain.summary).toEqual({ weaponClasses: [], defences: [], links: [], gems: 0, uniqueBases: 0, priced: 0 })
    const parsed = parse(plain.text)
    expect(parsed.filter((entry) => entry.kind === 'Hide')).toHaveLength(3)
    expect(parsed.some((entry) => /Every rare during the campaign/.test(entry.comment))).toBe(true)
    // With only the class known, the armour that class usually wears is used.
    expect(generateFilter({ characterClass: 'Witch', pob: null, setIndexes: [], prices: null }).summary.defences).toEqual(['Energy Shield'])
  })
})

describe('FilterWriter', () => {
  function setup(makeDir = true) {
    const root = mkdtempSync(join(tmpdir(), 'poe-filter-'))
    const dir = join(root, 'My Games', 'Path of Exile')
    if (makeDir) mkdirSync(dir, { recursive: true })
    const file = join(dir, 'PoE Progression.filter')
    let current = input
    const views: FilterView[] = []
    const make = () =>
      new FilterWriter({ file: join(root, 'filter.json'), defaultDir: dir, input: () => current, onChange: (view) => views.push(view) })
    return { root, dir, file, views, make, setInput: (next: FilterInput) => (current = next) }
  }

  it('writes nothing until the player switches it on', () => {
    const { file, make } = setup()
    const writer = make()
    writer.refresh()
    expect(existsSync(file)).toBe(false)
    expect(writer.view()).toMatchObject({ enabled: false, usePrices: true, useBuildNames: true, dirFound: true, writtenAt: null, error: null })
    expect(writer.view().command).toBe('/itemfilter PoE Progression')
    expect(writer.view().stages).toHaveLength(6)
  })

  it('writes the file once switched on and leaves it alone while nothing changes', () => {
    const { file, make, views, setInput } = setup()
    const writer = make()
    writer.setOptions({ enabled: true })
    expect(readFileSync(file, 'utf8')).toBe(generateFilter(input).text)
    expect(views.at(-1)).toMatchObject({ enabled: true, error: null })
    expect(views.at(-1)?.writtenAt).not.toBeNull()

    // An untouched build must not touch the file: its time tells the player when to reload.
    utimesSync(file, new Date(1_000_000), new Date(1_000_000))
    writer.refresh()
    expect(statSync(file).mtimeMs).toBe(1_000_000)

    setInput({ ...input, characterClass: 'Witch', pob: null, setIndexes: [] })
    writer.refresh()
    expect(statSync(file).mtimeMs).toBeGreaterThan(1_000_000)
    expect(readFileSync(file, 'utf8')).toContain('BaseEnergyShield > 0')
  })

  it('leaves prices out when asked, and remembers the options', () => {
    const { file, make } = setup()
    make().setOptions({ enabled: true, usePrices: false, useBuildNames: false })
    expect(readFileSync(file, 'utf8')).not.toContain('poe.ninja')
    expect(readFileSync(file, 'utf8')).not.toContain('Toxic Rain')
    const reopened = make()
    expect(reopened.view()).toMatchObject({ enabled: true, usePrices: false, useBuildNames: false })
    expect(reopened.view().summary.priced).toBe(0)
  })

  it('says so when the game folder is not there, and follows a folder chosen by hand', () => {
    const { root, dir, make } = setup(false)
    const writer = make()
    writer.setOptions({ enabled: true })
    expect(writer.view()).toMatchObject({ dirFound: false, dir, error: expect.stringMatching(/не найдена/) })
    expect(existsSync(dir)).toBe(false)

    writer.setOptions({ dir: root })
    expect(writer.view()).toMatchObject({ dirFound: true, dir: root, error: null })
    expect(existsSync(join(root, 'PoE Progression.filter'))).toBe(true)
    writer.setOptions({ dir: null })
    expect(writer.view().dir).toBe(dir)
  })
})
