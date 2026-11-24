import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PlanStore } from '../src/main/plan'
import { encode, SAMPLE_XML } from './pob.test'
import { checkGems, readCharacterGems, type GemCheckContext } from '../src/core/gems/check'
import type { CharacterGems, GemSource, PobBuild, PobGem } from '../src/shared/plan'

const G = 'Metadata/Items/Gems/'
const TR = `${G}SkillGemToxicRain`
const MIRAGE = `${G}SupportGemMirageArcher`
const VOID = `${G}SupportGemVoidManipulation`
const EFFICACY = `${G}SupportGemEfficacy`
const GRACE = `${G}SkillGemGrace`

const gem = (name: string, id: string | null, support: boolean, baseName: string | null = null): PobGem => ({
  id,
  name,
  baseName,
  level: 1,
  attribute: 'dexterity',
  support
})

const pob: PobBuild = {
  className: 'Ranger',
  ascendancy: null,
  level: 90,
  bandit: 'kill',
  skillSets: [
    {
      title: 'Acts',
      groups: [
        { label: 'Main', slot: null, gems: [gem('Mirage Archer', MIRAGE, true), gem('Toxic Rain', TR, false), gem('Void Manipulation', VOID, true), gem('Efficacy', EFFICACY, true)] },
        { label: '', slot: null, gems: [gem('Grace', GRACE, false)] }
      ]
    },
    { title: 'Endgame', groups: [{ label: 'Six', slot: null, gems: [gem('Storm Rain of the Conduit', `${G}SkillGemStormRain`, false, 'Storm Rain')] }] }
  ],
  treeSpecs: [],
  itemSets: [],
  notes: ''
}

const quest = (stepIndex: number): GemSource => ({ kind: 'quest', act: 1, quest: 'Breaking Some Eggs', npc: 'Tarkleigh', stepIndex })
const vendor = (stepIndex: number): GemSource => ({ kind: 'vendor', act: 1, quest: 'The Caged Brute', npc: 'Nessa', stepIndex })

const context = (patch: Partial<GemCheckContext> = {}): GemCheckContext => ({
  setIndexes: [0, 1],
  gemSources: { [TR]: quest(10), [MIRAGE]: quest(20), [VOID]: vendor(30), [EFFICACY]: vendor(400), [GRACE]: vendor(40) },
  position: 100,
  finished: false,
  level: 30,
  character: 'Tester',
  readAt: 5000,
  ...patch
})

const socketed = (name: string, slot: string, group: number, support = false): CharacterGems['socketed'][number] => ({
  name,
  support,
  level: 5,
  slot,
  group
})

describe('readCharacterGems', () => {
  it('reads socketed gems with the linked group each sits in, and gems in the inventory', () => {
    const body = {
      items: [
        {
          inventoryId: 'BodyArmour',
          sockets: [{ group: 0 }, { group: 0 }, { group: 1 }],
          socketedItems: [
            { typeLine: 'Toxic Rain', support: false, socket: 0, frameType: 4, properties: [{ name: 'Level', values: [['12', 0]] }] },
            { typeLine: 'Mirage Archer Support', support: true, socket: 1, frameType: 4, properties: [{ name: 'Level', values: [['8 (Max)', 0]] }] },
            { typeLine: 'Grace', support: false, socket: 2, frameType: 4 },
            { typeLine: 'Searching Eye Jewel', socket: 2, frameType: 2 }
          ]
        },
        { inventoryId: 'MainInventory', typeLine: 'Efficacy Support', frameType: 4 },
        { inventoryId: 'MainInventory', typeLine: 'Chaos Orb', frameType: 5 },
        { inventoryId: 'Ring', typeLine: 'Iron Ring' }
      ]
    }
    expect(readCharacterGems(body)).toEqual({
      socketed: [
        { name: 'Toxic Rain', support: false, level: 12, slot: 'BodyArmour', group: 0 },
        { name: 'Mirage Archer Support', support: true, level: 8, slot: 'BodyArmour', group: 0 },
        { name: 'Grace', support: false, level: null, slot: 'BodyArmour', group: 1 }
      ],
      loose: ['Efficacy Support']
    })
    expect(readCharacterGems({ error: 'nope' })).toBeNull()
  })
})

describe('checkGems', () => {
  const allGood: CharacterGems = {
    socketed: [
      socketed('Toxic Rain', 'BodyArmour', 0),
      socketed('Mirage Archer Support', 'BodyArmour', 0, true),
      socketed('Void Manipulation Support', 'BodyArmour', 0, true),
      socketed('Vaal Grace', 'Helm', 0)
    ],
    loose: []
  }
  const states = (gems: CharacterGems, patch: Partial<GemCheckContext> = {}) => {
    const check = checkGems(pob, gems, context(patch))!
    return { check, byName: Object.fromEntries(check.groups.flatMap((group) => group.gems).map((entry) => [entry.name, entry])) }
  }

  it('is content when everything due is socketed and linked', () => {
    const { check, byName } = states(allGood)
    expect(check).toMatchObject({ setIndex: 0, setTitle: 'Acts', problems: [], character: 'Tester', readAt: 5000 })
    expect(byName['Toxic Rain'].state).toBe('linked')
    expect(byName['Mirage Archer Support'].state).toBe('linked')
    // A Vaal gem does the job of the plain one.
    expect(byName['Grace'].state).toBe('linked')
    // Not obtainable yet: nothing to complain about.
    expect(byName['Efficacy Support']).toMatchObject({ state: 'later', hint: expect.stringMatching(/будет позже: купить у Nessa/) })
    expect(check.groups.map((group) => group.label)).toEqual(['Main', 'Grace'])
  })

  it('says which gem is missing and where to get it', () => {
    const { check, byName } = states({ socketed: allGood.socketed.filter((entry) => !entry.name.startsWith('Void')), loose: [] })
    expect(byName['Void Manipulation Support']).toMatchObject({ state: 'missing' })
    expect(check.problems).toEqual(['Нет Void Manipulation Support: купить у Nessa после «The Caged Brute» (акт 1)'])
  })

  it('notices a gem lying in the inventory', () => {
    const { check, byName } = states({
      socketed: allGood.socketed.filter((entry) => !entry.name.startsWith('Mirage')),
      loose: ['Mirage Archer Support']
    })
    expect(byName['Mirage Archer Support'].state).toBe('loose')
    expect(check.problems).toEqual(['Mirage Archer Support лежит в инвентаре, не вставлен'])
  })

  it('notices a support that is socketed apart from its skill', () => {
    const apart = allGood.socketed.map((entry) => (entry.name.startsWith('Void') ? { ...entry, slot: 'Gloves' } : entry))
    const { check, byName } = states({ socketed: apart, loose: [] })
    expect(byName['Void Manipulation Support']).toMatchObject({ state: 'unlinked', hint: 'не связан с Toxic Rain' })
    expect(check.problems).toEqual(['Void Manipulation Support не связан с Toxic Rain'])
    // Same item, another group of sockets: not linked either.
    const otherGroup = allGood.socketed.map((entry) => (entry.name.startsWith('Mirage') ? { ...entry, group: 1 } : entry))
    expect(states({ socketed: otherGroup, loose: [] }).check.problems).toEqual(['Mirage Archer Support не связан с Toxic Rain'])
  })

  it('asks for three linked gems early and four from level 25', () => {
    const withEfficacy: CharacterGems = { socketed: [...allGood.socketed, socketed('Efficacy Support', 'Gloves', 0, true)], loose: [] }
    const sources = { ...context().gemSources, [EFFICACY]: vendor(50) }
    // At level 12 a third support cannot be linked anyway: socketed elsewhere is fine.
    expect(states(withEfficacy, { level: 12, gemSources: sources }).check.problems).toEqual([])
    expect(states(withEfficacy, { level: 30, gemSources: sources }).check.problems).toEqual(['Efficacy Support не связан с Toxic Rain'])
  })

  it('does not ask for a gem the character is too low to use, if it is already in the bag', () => {
    const { byName, check } = states({ socketed: allGood.socketed.filter((entry) => entry.name !== 'Vaal Grace'), loose: ['Grace'] }, { level: 5 })
    expect(byName['Grace']).toMatchObject({ state: 'later', hint: expect.stringMatching(/нужен уровень \d+/) })
    expect(check.problems.join()).not.toMatch(/Grace/)
  })

  it('compares with the set the character is actually wearing', () => {
    const endgame: CharacterGems = { socketed: [socketed('Storm Rain', 'BodyArmour', 0)], loose: [] }
    const { check } = states(endgame, { finished: true })
    // The gem the transfigured one is made from counts as it.
    expect(check).toMatchObject({ setIndex: 1, setTitle: 'Endgame', problems: [] })
    // Nothing socketed at all: the first set, which a fresh character starts on.
    expect(states({ socketed: [], loose: [] }).check.setIndex).toBe(0)
    expect(checkGems(pob, endgame, context({ setIndexes: [] }))).toBeNull()
  })

  it('wants every gem once the campaign is over', () => {
    const { check } = states(allGood, { finished: true, level: 70 })
    expect(check.problems).toEqual(['Нет Efficacy Support: купить у Nessa после «The Caged Brute» (акт 1)'])
  })
})

describe('PlanStore with the character\'s gems', () => {
  it('checks them against the build and keeps them over a restart', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'poe-plan-gems-')), 'plan.json')
    const plan = new PlanStore(file)
    expect(plan.followsGems).toBe(false)
    plan.importPob(encode(SAMPLE_XML))
    expect(plan.followsGems).toBe(true)
    expect(plan.view().gemCheck).toBeNull()

    plan.setLevel(20)
    plan.setPosition(plan.view().steps.length)
    plan.setCharacterGems('Tester', { socketed: [{ name: 'Toxic Rain', support: false, level: 10, slot: 'BodyArmour', group: 0 }], loose: [] }, 7000)
    const check = plan.view().gemCheck!
    expect(check).toMatchObject({ setTitle: 'Acts 1-3', character: 'Tester', readAt: 7000 })
    expect(check.problems.some((problem) => /^Нет Mirage Archer Support/.test(problem))).toBe(true)

    expect(new PlanStore(file).view().gemCheck).toMatchObject({ character: 'Tester', readAt: 7000 })
    // Another build is another character.
    plan.chooseBuild(plan.view().ranked[0]?.build.id ?? 'none')
    plan.clearPob()
    expect(plan.view().gemCheck).toBeNull()
  })
})
