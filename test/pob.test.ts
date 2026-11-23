import { deflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { decodePobCode, parsePobCode, PobError } from '../src/core/pob/parse'
import { buildPlanRoute } from '../src/core/route/build'
import { requiredGems } from '../src/core/route/gems'
import { PlanStore } from '../src/main/plan'
import type { Fragment, RouteOptions } from '../src/shared/plan'

const G = 'Metadata/Items/Gems/'

export const SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="92" targetVersion="3_0" className="Ranger" ascendClassName="Deadeye" bandit="Alira" mainSocketGroup="1">
    <PlayerStat stat="Life" value="4200"/>
  </Build>
  <Skills activeSkillSet="2">
    <SkillSet id="1" title="^7Acts 1-3">
      <Skill enabled="true" label="" slot="Body Armour">
        <Gem nameSpec="Toxic Rain" gemId="${G}SkillGemToxicRain" level="10" enabled="true"/>
        <Gem nameSpec="Mirage Archer" gemId="${G}SupportGemMirageArcher" level="8" enabled="true"/>
        <Gem nameSpec="Void Manipulation" gemId="${G}SupportGemVoidManipulation" level="1" enabled="false"/>
      </Skill>
      <Skill enabled="true" label="Auras"/>
      <Skill enabled="true" label="">
        <Gem nameSpec="Grace" gemId="${G}SkillGemGrace" level="5" enabled="true"/>
      </Skill>
      <Skill source="Item:1:Some Unique" enabled="true" label="">
        <Gem nameSpec="Reflection" skillId="UniqueMirageWarriors" level="20" enabled="true"/>
      </Skill>
      <Skill enabled="true" label="Utility">
        <Gem nameSpec="Controlled Destruction" gemId="${G}SupportGemControlledDestruction" level="1" enabled="true"/>
      </Skill>
      <Skill enabled="false" label="Unused">
        <Gem nameSpec="Fireball" gemId="${G}SkillGemFireball" level="1" enabled="true"/>
      </Skill>
    </SkillSet>
    <SkillSet id="2" title="Endgame">
      <Skill enabled="true" label="Main 6L" slot="Body Armour">
        <Gem nameSpec="Storm Rain of the Conduit" gemId="${G}SkillGemStormRain" variantId="StormRainAltX" level="20" enabled="true"/>
        <Gem nameSpec="Mirage Archer" gemId="${G}SupportGemMirageArcher" level="20" enabled="true"/>
        <Gem nameSpec="Mirage Archer" gemId="${G}SupportGemMirageArcher" level="20" enabled="true"/>
        <Gem nameSpec="Some Future Gem" gemId="${G}SkillGemDoesNotExistYet" level="20" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Tree activeSpec="2">
    <Spec title="Level 30" treeVersion="3_30" nodes="1,2,3,4,5">
      <URL>
        https://www.pathofexile.com/passive-skill-tree/AAAABgIA
      </URL>
    </Spec>
    <Spec title="Endgame" treeVersion="3_30" nodes="1,2,3"/>
  </Tree>
  <Items activeItemSet="1">
    <Item id="1">
			Rarity: UNIQUE
Hyrri's Ire
Zodiac Leather
Unique ID: abc
Item Level: 84
Sockets: G-G-G G-B
Corrupted
    </Item>
    <Item id="2">
			Rarity: RARE
Doom Thirst
Spine Bow
Item Level: 80
Sockets: G-G-G-G-G-G
LevelReq: 64
Implicits: 0
Adds (10-15) to (20-25) Physical Damage
{fractured}{range:0.5}(15-18)% increased Attack Speed
{crafted}{range:1}+(20-25)% to Global Critical Strike Multiplier
Shaper Item
Hunter Item
    </Item>
    <Item id="3">
			Rarity: MAGIC
Seething Divine Life Flask of Sealing
Quality: 20
    </Item>
    <ItemSet id="1" title="Early maps">
      <Slot name="Body Armour" itemId="1"/>
      <Slot name="Weapon 1" itemId="2"/>
      <Slot name="Flask 1" itemId="3"/>
      <Slot name="Helmet" itemId="0"/>
    </ItemSet>
  </Items>
  <Notes>^xFFAA00Level with Toxic Rain^7, swap at 28.</Notes>
</PathOfBuilding>`

export function encode(xml: string): string {
  return deflateSync(Buffer.from(xml, 'utf8')).toString('base64').replace(/\+/g, '-').replace(/\//g, '_')
}

const CODE = encode(SAMPLE_XML)
const options: RouteOptions = { bandit: 'kill', leagueStart: true, library: false }

describe('parsePobCode', () => {
  const pob = parsePobCode(CODE)

  it('reads the character', () => {
    expect(pob).toMatchObject({ className: 'Ranger', ascendancy: 'Deadeye', level: 92, bandit: 'alira' })
  })

  it('reads skill sets, skipping disabled groups and gems and stripping colour codes', () => {
    expect(pob.skillSets.map((set) => set.title)).toEqual(['Acts 1-3', 'Endgame'])
    const [acts] = pob.skillSets
    expect(acts.groups.map((group) => group.gems.map((gem) => gem.name))).toEqual([
      ['Toxic Rain', 'Mirage Archer'],
      ['Grace'],
      ['Controlled Destruction']
    ])
  })

  it('labels groups: own label, else the heading above, else the main skill', () => {
    const [acts, endgame] = pob.skillSets
    expect(acts.groups.map((group) => group.label)).toEqual(['Toxic Rain', 'Auras', 'Utility'])
    expect(endgame.groups[0]).toMatchObject({ label: 'Main 6L', slot: 'Body Armour' })
  })

  it('resolves gems against the game data', () => {
    const [toxicRain, mirage] = pob.skillSets[0].groups[0].gems
    expect(toxicRain).toMatchObject({ id: `${G}SkillGemToxicRain`, attribute: 'dexterity', support: false, baseName: null })
    expect(mirage).toMatchObject({ support: true, baseName: null })
  })

  it('keeps the transfigured name and remembers the base gem to pick up', () => {
    const stormRain = pob.skillSets[1].groups[0].gems[0]
    expect(stormRain).toMatchObject({ name: 'Storm Rain of the Conduit', baseName: 'Storm Rain', id: `${G}SkillGemStormRain` })
  })

  it('keeps gems it does not know, without an id', () => {
    expect(pob.skillSets[1].groups[0].gems[3]).toMatchObject({ name: 'Some Future Gem', id: null })
  })

  it('reads tree specs', () => {
    expect(pob.treeSpecs).toEqual([
      { title: 'Level 30', url: 'https://www.pathofexile.com/passive-skill-tree/AAAABgIA', nodes: 5 },
      { title: 'Endgame', url: null, nodes: 3 }
    ])
  })

  it('reads equipped items and skips empty slots', () => {
    expect(pob.itemSets).toEqual([
      {
        title: 'Early maps',
        items: [
          {
            slot: 'Body Armour',
            rarity: 'UNIQUE',
            name: "Hyrri's Ire",
            base: 'Zodiac Leather',
            links: 3,
            influences: [],
            craftedMods: [],
            fractured: false,
            corrupted: true
          },
          {
            slot: 'Weapon 1',
            rarity: 'RARE',
            name: 'Doom Thirst',
            base: 'Spine Bow',
            links: 6,
            influences: ['Shaper', 'Hunter'],
            craftedMods: ['+(20-25)% to Global Critical Strike Multiplier'],
            fractured: true,
            corrupted: false
          },
          {
            slot: 'Flask 1',
            rarity: 'MAGIC',
            name: 'Seething Divine Life Flask of Sealing',
            base: null,
            links: 0,
            influences: [],
            craftedMods: [],
            fractured: false,
            corrupted: false
          }
        ]
      }
    ])
  })

  it('reads notes without colour codes', () => {
    expect(pob.notes).toBe('Level with Toxic Rain, swap at 28.')
  })

  it('accepts a code with line breaks and standard base64 characters', () => {
    const standard = CODE.replace(/-/g, '+').replace(/_/g, '/')
    const wrapped = standard.replace(/(.{60})/g, '$1\n')
    expect(parsePobCode(wrapped).className).toBe('Ranger')
  })

  it('explains what is wrong with bad input', () => {
    expect(() => decodePobCode('')).toThrow(PobError)
    expect(() => decodePobCode('https://pobb.in/abc')).toThrow(/ссылка/)
    expect(() => decodePobCode('привет')).toThrow(/не похоже/)
    expect(() => decodePobCode(CODE.slice(0, 40))).toThrow(/не распаковывается/)
    expect(() => parsePobCode(encode('<Other/>'))).toThrow(/нет билда/)
  })
})

describe('gems on the route', () => {
  const pob = parsePobCode(CODE)
  const gemSteps = (sets: number[], characterClass = 'Ranger') => {
    const route = buildPlanRoute(options, { characterClass, required: requiredGems(pob, sets) })
    const gems = route.steps.flatMap((step) =>
      step.parts.flatMap((part) => (part.type === 'gem' ? [{ ...part, act: step.act, step }] : []))
    )
    return { route, gems }
  }

  it('lists required gems in build order with the largest count seen in one set', () => {
    expect(requiredGems(pob, [0, 1]).map((gem) => [gem.name, gem.count, gem.note])).toEqual([
      ['Toxic Rain', 1, 'Acts 1-3 · Toxic Rain'],
      ['Mirage Archer Support', 2, 'Acts 1-3 · Toxic Rain'],
      ['Grace', 1, 'Acts 1-3 · Auras'],
      ['Controlled Destruction Support', 1, 'Acts 1-3 · Utility'],
      ['Storm Rain', 1, 'Endgame · Main 6L']
    ])
    expect(requiredGems(pob, [0]).map((gem) => [gem.name, gem.count])).toEqual([
      ['Toxic Rain', 1],
      ['Mirage Archer Support', 1],
      ['Grace', 1],
      ['Controlled Destruction Support', 1]
    ])
  })

  it('takes gems as quest rewards where the class is offered them', () => {
    const { gems } = gemSteps([0])
    expect(gems.map((gem) => [gem.name, gem.reward, gem.act])).toEqual([
      ['Mirage Archer Support', 'quest', 1],
      ['Toxic Rain', 'quest', 1],
      ['Grace', 'quest', 3]
    ])
  })

  it('buys the extra copy from the vendor at the same hand-in', () => {
    const { gems } = gemSteps([0, 1])
    const mirage = gems.filter((gem) => gem.name === 'Mirage Archer Support')
    expect(mirage.map((gem) => [gem.reward, gem.count, gem.npc])).toEqual([
      ['quest', 1, 'Nessa'],
      ['vendor', 1, 'Nessa']
    ])
  })

  it('puts gem steps in town right after the quest step and records the source', () => {
    const { route, gems } = gemSteps([0])
    const toxicRain = gems.find((gem) => gem.name === 'Toxic Rain')!
    const previous = route.steps[toxicRain.step.index - 1]
    expect(previous.parts.some((part: Fragment) => part.type === 'quest')).toBe(true)
    expect(toxicRain.step).toMatchObject({ areaId: '1_1_town', arrivesAt: null })
    expect(route.gemSources[`${G}SkillGemToxicRain`]).toMatchObject({
      kind: 'quest',
      act: 1,
      quest: "The Siren's Cadence",
      stepIndex: toxicRain.step.index
    })
  })

  it('falls back to Lilly Roth in Act 6 for gems the class is not offered', () => {
    const { route } = gemSteps([0], 'Marauder')
    expect(route.gemSources[`${G}SkillGemToxicRain`]).toMatchObject({ kind: 'vendor', npc: 'Lilly Roth', act: 6 })
  })

  it('keeps step indexes consecutive and the walk consistent with gem steps inserted', () => {
    const { route } = gemSteps([0, 1])
    let area = '1_1_1'
    route.steps.forEach((step, i) => {
      expect(step.index).toBe(i)
      expect(step.areaId).toBe(area)
      if (step.arrivesAt) area = step.arrivesAt
    })
  })

  it('does not attach route hints to gem steps', () => {
    const { route } = gemSteps([0, 1])
    for (const step of route.steps) {
      if (step.parts.some((part) => part.type === 'gem')) expect(step.subSteps).toEqual([])
    }
  })
})

describe('PlanStore with a PoB build', () => {
  it('imports a build, takes its class and bandit, and adds gem steps', () => {
    const plan = new PlanStore(null)
    expect(plan.importPob(CODE)).toBeNull()
    const view = plan.view()
    expect(view).toMatchObject({ characterClass: 'Ranger', pobSets: [0, 1] })
    expect(view.options.bandit).toBe('alira')
    expect(view.steps.some((step) => step.parts.some((part) => part.type === 'gem'))).toBe(true)
    expect(Object.keys(view.gemSources)).toHaveLength(4)
  })

  it('reports a readable error and changes nothing on a bad code', () => {
    const plan = new PlanStore(null)
    expect(plan.importPob('not a code!')).toMatch(/не похоже/)
    expect(plan.view().pob).toBeNull()
  })

  it('points out gems only the Library sells to this class, until the detour is enabled', () => {
    const plan = new PlanStore(null)
    plan.importPob(CODE)
    expect(plan.view().libraryOnlyGems).toEqual(['Controlled Destruction Support'])
    plan.setOptions({ library: true })
    const view = plan.view()
    expect(view.libraryOnlyGems).toEqual([])
    expect(view.gemSources[`${G}SupportGemControlledDestruction`]).toMatchObject({ npc: 'Siosa', act: 3 })
  })

  it('limits gem steps to the selected skill sets', () => {
    const plan = new PlanStore(null)
    plan.importPob(CODE)
    plan.setPobSets([0])
    expect(Object.keys(plan.view().gemSources)).toHaveLength(3)
    plan.setPobSets([])
    expect(plan.view().steps.some((step) => step.parts.some((part) => part.type === 'gem'))).toBe(false)
  })

  it('keeps the place in the story when the build of the same class is imported mid-campaign', () => {
    const plan = new PlanStore(null)
    plan.chooseBuild('storm-rain-deadeye')
    const act3 = plan.view().steps.findIndex((step) => step.act === 3 && step.areaId === '1_3_town')
    plan.setPosition(act3)
    plan.importPob(CODE)
    expect(plan.view().steps[plan.view().position]).toMatchObject({ act: 3, areaId: '1_3_town' })
  })

  it('drops the imported build when another card is chosen, and on request', () => {
    const plan = new PlanStore(null)
    plan.importPob(CODE)
    plan.chooseBuild('srs-guardian')
    expect(plan.view()).toMatchObject({ pob: null, characterClass: 'Templar' })
    plan.importPob(CODE)
    plan.clearPob()
    expect(plan.view()).toMatchObject({ pob: null, characterClass: 'Templar' })
  })
})
