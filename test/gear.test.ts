import { describe, expect, it } from 'vitest'
import { checkGear, readCharacterGear } from '../src/core/gear/check'
import { checkGems } from '../src/core/gems/check'
import type { CharacterGear, PobBuild, PobItem, PobMod, WornItem } from '../src/shared/plan'

const mod = (text: string): PobMod => ({ text, crafted: false, fractured: false })
const item = (slot: string, name: string, base: string, patch: Partial<PobItem> = {}): PobItem => ({
  slot,
  name,
  base,
  rarity: 'RARE',
  links: 0,
  influences: [],
  craftedMods: [],
  fractured: false,
  corrupted: false,
  itemLevel: 84,
  mods: [],
  ...patch
})
const worn = (slot: string, name: string, base: string, patch: Partial<WornItem> = {}): WornItem => ({
  slot,
  name,
  base,
  rarity: 'Rare',
  links: 0,
  itemLevel: 80,
  mods: [],
  ...patch
})

const shell = item('Body Armour', 'Doom Shell', 'Zodiac Leather', {
  links: 6,
  mods: [mod('+(100-114) to maximum Life'), mod('+42% to Fire Resistance'), mod('92% increased Evasion Rating')]
})
const build = (sets: Record<string, PobItem[]>): PobBuild => ({
  className: 'Ranger',
  ascendancy: null,
  level: 90,
  bandit: 'kill',
  skillSets: [],
  treeSpecs: [],
  itemSets: Object.entries(sets).map(([title, items]) => ({ title, items })),
  notes: ''
})
const gear = (items: WornItem[], carriedUniques: string[] = []): CharacterGear => ({ worn: items, carriedUniques })

describe('readCharacterGear', () => {
  it('reads what is worn, with links, and the uniques in the inventory', () => {
    const body = {
      items: [
        {
          inventoryId: 'BodyArmour',
          name: 'Doom Shell',
          typeLine: 'Zodiac Leather',
          baseType: 'Zodiac Leather',
          frameType: 2,
          ilvl: 84,
          sockets: [{ group: 0 }, { group: 0 }, { group: 0 }, { group: 1 }],
          explicitMods: ['+105 to maximum Life'],
          craftedMods: [{ description: '+30% to Cold Resistance' }],
          fracturedMods: ['+12% to Chaos Resistance']
        },
        { inventoryId: 'Ring', name: '', typeLine: 'Seething Iron Ring of Skill', baseType: 'Iron Ring', frameType: 1 },
        { inventoryId: 'Flask', typeLine: 'Divine Life Flask', frameType: 0 },
        { inventoryId: 'MainInventory', name: "Kaom's Heart", typeLine: 'Glorious Plate', frameType: 3 },
        { inventoryId: 'MainInventory', name: 'Junk', typeLine: 'Iron Ring', frameType: 2 }
      ]
    }
    expect(readCharacterGear(body)).toEqual({
      worn: [
        {
          slot: 'BodyArmour',
          name: 'Doom Shell',
          base: 'Zodiac Leather',
          rarity: 'Rare',
          links: 3,
          itemLevel: 84,
          mods: ['+105 to maximum Life', '+30% to Cold Resistance', '+12% to Chaos Resistance']
        },
        { slot: 'Ring', name: '', base: 'Iron Ring', rarity: 'Magic', links: 0, itemLevel: null, mods: [] }
      ],
      carriedUniques: ["Kaom's Heart"]
    })
    expect(readCharacterGear({})).toBeNull()
  })
})

describe('checkGear', () => {
  it('compares a rare modifier by modifier: there or not, as high or lower', () => {
    const check = checkGear(
      build({ Maps: [shell] }),
      gear([worn('BodyArmour', 'Rage Coat', 'Zodiac Leather', { links: 4, mods: ['+85 to maximum Life', '+45% to Fire Resistance'] })]),
      'Tester',
      9000
    )!
    expect(check).toMatchObject({ setTitle: 'Maps', character: 'Tester', readAt: 9000 })
    const [slot] = check.slots
    expect(slot).toMatchObject({ slot: 'Body Armour', state: 'partial', worn: { name: 'Rage Coat', links: 4 }, wanted: { name: 'Doom Shell', links: 6 } })
    expect(slot.mods).toEqual([
      { text: '+(100-114) to maximum Life', state: 'lower', worn: '+85 to maximum Life' },
      { text: '+42% to Fire Resistance', state: 'have', worn: '+45% to Fire Resistance' },
      { text: '92% increased Evasion Rating', state: 'absent', worn: null }
    ])
    expect(slot.notes).toEqual(['Связей 4 из 6.'])
  })

  it('calls a rare with every modifier of the build a match, whatever its name', () => {
    const same = worn('BodyArmour', 'Other Name', 'Zodiac Leather', {
      links: 6,
      mods: ['+110 to maximum Life', '+42% to Fire Resistance', '95% increased Evasion Rating']
    })
    expect(checkGear(build({ Maps: [shell] }), gear([same]), 'T', 0)!.slots[0]).toMatchObject({ state: 'match', notes: [] })
    const otherBase = { ...same, base: 'Assassin\'s Garb' }
    expect(checkGear(build({ Maps: [shell] }), gear([otherBase]), 'T', 0)!.slots[0].notes).toEqual(['База другая: в билде Zodiac Leather.'])
    expect(checkGear(build({ Maps: [shell] }), gear([worn('BodyArmour', 'x', 'y', { mods: ['+5 to Strength'] })]), 'T', 0)!.slots[0].state).toBe('different')
    expect(checkGear(build({ Maps: [shell] }), gear([]), 'T', 0)!.slots[0]).toMatchObject({ state: 'empty', worn: null })
  })

  it('matches a unique by name and says when it is in the bag', () => {
    const heart = item('Body Armour', "Kaom's Heart", 'Glorious Plate', { rarity: 'UNIQUE' })
    const pob = build({ Endgame: [heart] })
    const wearing = gear([worn('BodyArmour', "Kaom's Heart", 'Glorious Plate', { rarity: 'Unique' })])
    expect(checkGear(pob, wearing, 'T', 0)!.slots[0]).toMatchObject({ state: 'match', mods: [] })
    const carrying = gear([worn('BodyArmour', 'Rage Coat', 'Zodiac Leather')], ["Kaom's Heart"])
    expect(checkGear(pob, carrying, 'T', 0)!.slots[0]).toMatchObject({ state: 'different', notes: ['Этот уник лежит в инвентаре.'] })
    const foulborn = build({ Endgame: [{ ...heart, name: "Foulborn Kaom's Heart" }] })
    expect(checkGear(foulborn, wearing, 'T', 0)!.slots[0]).toMatchObject({ state: 'partial', notes: ['Надета обычная версия, в билде — Foulborn.'] })
  })

  it('compares with the item set the character is closest to', () => {
    const heart = item('Body Armour', "Kaom's Heart", 'Glorious Plate', { rarity: 'UNIQUE' })
    const pob = build({ Maps: [shell], Endgame: [heart] })
    expect(checkGear(pob, gear([worn('BodyArmour', "Kaom's Heart", 'Glorious Plate', { rarity: 'Unique' })]), 'T', 0)).toMatchObject({ setIndex: 1, setTitle: 'Endgame' })
    // Nothing alike anywhere: the first set.
    expect(checkGear(pob, gear([]), 'T', 0)).toMatchObject({ setIndex: 0 })
    expect(checkGear(build({}), gear([]), 'T', 0)).toBeNull()
  })

  it('lets the two rings be worn either way round and skips flasks', () => {
    const fire = item('Ring 1', 'Fire Loop', 'Ruby Ring', { mods: [mod('+40% to Fire Resistance')] })
    const cold = item('Ring 2', 'Cold Loop', 'Sapphire Ring', { mods: [mod('+40% to Cold Resistance')] })
    const flask = item('Flask 1', 'Divine Life Flask', 'Divine Life Flask', { rarity: 'MAGIC' })
    const check = checkGear(
      build({ Maps: [fire, cold, flask] }),
      gear([worn('Ring', 'a', 'Sapphire Ring', { mods: ['+41% to Cold Resistance'] }), worn('Ring2', 'b', 'Ruby Ring', { mods: ['+44% to Fire Resistance'] })]),
      'T',
      0
    )!
    expect(check.slots.map((slot) => `${slot.slot}: ${slot.state} (${slot.worn?.name})`)).toEqual(['Ring 1: match (b)', 'Ring 2: match (a)'])
    // A build with one ring finds it on whichever finger it is.
    const one = checkGear(build({ Maps: [fire] }), gear([worn('Ring2', 'b', 'Ruby Ring', { mods: ['+44% to Fire Resistance'] })]), 'T', 0)!
    expect(one.slots).toEqual([expect.objectContaining({ slot: 'Ring 1', state: 'match' })])
  })
})

describe('gem levels', () => {
  const G = 'Metadata/Items/Gems/'
  const gem = (name: string, id: string, level: number, support = false) => ({ id, name, baseName: null, level, attribute: 'dexterity' as const, support })
  const pob: PobBuild = {
    className: 'Ranger',
    ascendancy: null,
    level: 90,
    bandit: 'kill',
    skillSets: [
      { title: 'Acts', groups: [{ label: 'Main', slot: null, gems: [gem('Toxic Rain', `${G}SkillGemToxicRain`, 10)] }] },
      {
        title: 'Endgame',
        groups: [
          { label: 'Main', slot: null, gems: [gem('Toxic Rain', `${G}SkillGemToxicRain`, 20)] },
          { label: 'Guard', slot: null, gems: [gem('Grace', `${G}SkillGemGrace`, 3)] }
        ]
      }
    ],
    treeSpecs: [],
    itemSets: [],
    notes: ''
  }
  const check = (levels: { rain: number; grace: number }, setIndexes = [1]) =>
    checkGems(
      pob,
      {
        socketed: [
          { name: 'Toxic Rain', support: false, level: levels.rain, slot: 'BodyArmour', group: 0 },
          { name: 'Grace', support: false, level: levels.grace, slot: 'Helm', group: 0 }
        ],
        loose: []
      },
      { setIndexes, gemSources: {}, position: 0, finished: true, level: 90, character: 'T', readAt: 0 }
    )!

  it('shows the level of each gem next to the level in the build', () => {
    const gems = check({ rain: 14, grace: 3 }).groups.flatMap((group) => group.gems)
    expect(gems).toEqual([
      expect.objectContaining({ name: 'Toxic Rain', level: 14, wanted: 20, overLevelled: false }),
      expect.objectContaining({ name: 'Grace', level: 3, wanted: 3, overLevelled: false })
    ])
  })

  it('flags a gem levelled past what the build keeps it at, and only such a gem', () => {
    const result = check({ rain: 21, grace: 7 })
    // Toxic Rain goes to 20 in the build: 21 is no mistake. Grace is held at 3 everywhere.
    expect(result.levelRemarks).toEqual(['Grace: уровень 7, в билде не выше 3'])
    // It is a remark, not a problem: the overlay stays quiet about it.
    expect(result.problems).toEqual([])
    expect(result.groups[1].gems[0]).toMatchObject({ overLevelled: true, level: 7 })
  })

  it('does not mind a gem above its level in an early set when a later set takes it higher', () => {
    expect(check({ rain: 14, grace: 1 }, [0]).levelRemarks).toEqual([])
  })

  it('takes the levels of a build with only low gems as placeholders', () => {
    const sketch: PobBuild = { ...pob, skillSets: [pob.skillSets[0]] }
    const result = checkGems(
      sketch,
      { socketed: [{ name: 'Toxic Rain', support: false, level: 15, slot: 'BodyArmour', group: 0 }], loose: [] },
      { setIndexes: [0], gemSources: {}, position: 0, finished: true, level: 90, character: 'T', readAt: 0 }
    )!
    expect(result.levelRemarks).toEqual([])
    expect(result.groups[0].gems[0]).toMatchObject({ level: 15, wanted: 10, overLevelled: false })
  })
})
