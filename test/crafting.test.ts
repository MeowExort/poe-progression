import { describe, expect, it } from 'vitest'
import { BASES, BENCH, ESSENCES, GENESIS, METHODS, MODS } from '../src/core/crafting/data'
import { itemTags, matchMod, spawnWeight, statKey, statRanges, tiersOf } from '../src/core/crafting/match'
import { describeRare } from '../src/core/crafting/ways'
import { buildSourcing } from '../src/core/sources'
import { PlanStore } from '../src/main/plan'
import type { PobBuild, PobItem, PobMod } from '../src/shared/plan'
import { encode, SAMPLE_XML } from './pob.test'

const line = (text: string, patch: Partial<PobMod> = {}): PobMod => ({ text, crafted: false, fractured: false, ...patch })
const rare = (base: string, mods: PobMod[], patch: Partial<PobItem> = {}): PobItem => ({
  slot: 'Body Armour',
  name: 'Doom Shell',
  base,
  rarity: 'RARE',
  links: 0,
  influences: [],
  craftedMods: [],
  fractured: false,
  corrupted: false,
  itemLevel: 84,
  mods,
  ...patch
})

describe('the game data behind crafting', () => {
  it('is all there', () => {
    expect(Object.keys(MODS).length).toBeGreaterThan(4000)
    expect(ESSENCES.length).toBeGreaterThan(90)
    expect(BENCH.length).toBeGreaterThan(500)
    expect(GENESIS.filter((node) => node.tree === 'Unique Items').length).toBeGreaterThan(30)
    expect(BASES['Zodiac Leather']).toMatchObject({ type: 'Body Armour', attributes: ['dex'], influence: 'body_armour' })
  })

  it('names only Genesis passives and modifier tags that exist', () => {
    const names = new Set(GENESIS.map((node) => `${node.tree}/${node.name}`))
    for (const label of Object.values(METHODS.genesis.modifierNodes)) expect(names).toContain(`Equipment/Increased ${label} Modifier Chance`)
    for (const slot of Object.values(METHODS.genesis.equipmentSlots)) expect(names).toContain(`Equipment/Increased ${slot} Chance`)
    for (const slot of Object.values(METHODS.genesis.uniqueSlots)) expect(names).toContain(`Unique Items/Increased ${slot} Chance`)
    const tags = new Set(Object.values(MODS).flatMap((mod) => mod.tags))
    for (const fossil of METHODS.fossils) for (const tag of [...fossil.more, ...(fossil.none ?? []), ...(fossil.fewer ?? [])]) expect(tags, fossil.name).toContain(tag)
    for (const craft of METHODS.harvest) expect(tags, craft.label).toContain(craft.tag)
  })
})

describe('matching a line of an item to a modifier', () => {
  const tags = itemTags(BASES['Zodiac Leather'], [])

  it('takes the numbers out of a stat line, rolled or as a range', () => {
    expect(statKey('+(100-114) to maximum Life')).toBe(statKey('+92 to maximum Life'))
    expect(statKey('Adds (10-15) to (20-25) Physical Damage')).toBe('adds # to # physical damage')
    expect(statRanges('Adds (10-15) to 22 Physical Damage')).toEqual([[10, 15], [22, 22]])
  })

  it('finds the tier a rolled value belongs to', () => {
    const matched = matchMod(line('+118 to maximum Life'), tags)!
    expect(matched).toMatchObject({ exact: true, mod: { type: 'Prefix', group: 'IncreasedLife' } })
    const [low, high] = statRanges(matched.mod.stats[0])[0]
    expect(low <= 118 && 118 <= high).toBe(true)
  })

  it('takes a line written with its range as the tier itself', () => {
    const top = tiersOf(matchMod(line('+50 to maximum Life'), tags)!.mod, tags)[0]
    expect(matchMod(line(top.mod.stats[0]), tags)).toMatchObject({ id: top.id, exact: true })
  })

  it('guesses the nearest tier for a value no tier holds, and says it is a guess', () => {
    expect(matchMod(line('+9999 to maximum Life'), tags)).toMatchObject({ exact: false, mod: { group: 'IncreasedLife' } })
    expect(matchMod(line('Grants a Free Lunch'), tags)).toBeNull()
  })

  it('numbers the tiers from the best down, counting only what this base can roll', () => {
    const tiers = tiersOf(MODS['IncreasedLife0'], tags)
    expect(tiers.length).toBeGreaterThan(8)
    expect(tiers.map((tier) => tier.mod.level)).toEqual([...tiers.map((tier) => tier.mod.level)].sort((a, b) => b - a))
    // Weapons do not roll life: there are no tiers of it on a bow.
    expect(tiersOf(MODS['IncreasedLife0'], itemTags(BASES['Thicket Bow'], []))).toEqual([])
  })

  it('adds the tag of an influence, which is what lets influence modifiers roll', () => {
    expect(itemTags(BASES['Zodiac Leather'], ['Shaper', 'Hunter'])).toContain('body_armour_shaper')
    expect(itemTags(BASES['Zodiac Leather'], ['Hunter'])).toContain('body_armour_basilisk')
    const shaperOnly = Object.values(MODS).find((mod) => mod.weights?.some(([tag, weight]) => tag === 'body_armour_shaper' && weight > 0))!
    expect(spawnWeight(shaperOnly, tags)).toBe(0)
    expect(spawnWeight(shaperOnly, itemTags(BASES['Zodiac Leather'], ['Shaper']))).toBeGreaterThan(0)
  })
})

describe('ways to get the modifiers of a rare item', () => {
  const item = rare('Zodiac Leather', [
    line('+118 to maximum Life'),
    line('+42% to Fire Resistance'),
    line('+38% to Cold Resistance'),
    line('92% increased Evasion Rating'),
    line('+(25-30)% to Chaos Resistance', { crafted: true }),
    line('(15-18)% increased Attack Speed', { fractured: true }),
    line('Grants a Free Lunch')
  ])
  const described = describeRare(item, BASES['Zodiac Leather'])
  const mod = (text: string) => described.mods.find((entry) => entry.text.startsWith(text))!
  const way = (text: string, id: string) => mod(text).ways.find((entry) => entry.id === id)

  it('says what each modifier is: affix, tier, the item level it needs', () => {
    expect(mod('+118')).toMatchObject({ affix: 'Prefix', key: 'mod0', chosen: null })
    expect(mod('+118').tier).toBeGreaterThan(1)
    expect(mod('+118').tiers).toBeGreaterThan(8)
    expect(mod('+42%')).toMatchObject({ affix: 'Suffix' })
    expect(described.needsItemLevel).toBe(Math.max(...['+118', '+42%', '+38%', '92%'].map((text) => mod(text).level!)))
  })

  it('lists every way side by side: roll, fossil, Harvest, essence, bench', () => {
    expect(mod('+118').ways.map((entry) => entry.kind)).toEqual(['roll', 'fossil', 'harvest', 'essence', 'bench'])
    expect(way('+118', 'roll')!.details.join(' ')).toMatch(/Это T\d+ из \d+; нужен уровень предмета \d+\+\. Примерно [\d,]+% на каждый случайный префикс/)
    expect(way('+118', 'essence')!.title).toMatch(/^Эссенция: \w+ Essence of Greed$/)
    expect(way('+118', 'harvest:life')!.details[0]).toBe('Стоит 75 Wild Crystallised Lifeforce.')
    expect(way('+118', 'bench')).toMatchObject({ tone: 'info', details: expect.arrayContaining(['Это слабее, чем значение в билде.']) })
    // The bench offers life alone, not the craft that pairs it with a defence.
    expect(way('+118', 'bench')!.details[0]).toMatch(/^Лучший вариант станка: \+\(\d+-\d+\) to maximum Life\.$/)
  })

  it('warns when a fossil forbids another modifier of the same item', () => {
    // Pristine raises life but removes defence modifiers, and the item has one.
    expect(way('+118', 'fossil:Pristine Fossil')).toMatchObject({ tone: 'bad' })
    expect(way('+118', 'fossil:Pristine Fossil')!.details.join(' ')).toMatch(/вместо [\d,]+%.*У вещи есть мод с тегом defences/)
    // The fossil that forbids nothing the item has comes before the one that does.
    expect(mod('+42%').ways.filter((entry) => entry.kind === 'fossil').map((entry) => entry.tone)).toEqual(['good', 'bad'])
  })

  it('treats a crafted line as a bench craft and a fractured one as something to find', () => {
    // The bench has no such recipe for a body armour: it is still shown as a craft, without a promise.
    expect(mod('+(25-30)% to Chaos').ways).toEqual([expect.objectContaining({ kind: 'bench', tone: 'info', title: 'Крафт или зачарование' })])
    const recipe = BENCH.find((craft) => craft.group === 'IncreasedLife' && craft.types.includes('Body Armour'))!
    const crafted = describeRare(
      rare('Zodiac Leather', [line(recipe.stats[0], { crafted: true }), line('Allocates Tenacity', { crafted: true })]),
      BASES['Zodiac Leather']
    )
    expect(crafted.mods[0].ways).toEqual([expect.objectContaining({ kind: 'bench', tone: 'good', title: 'Станок в убежище' })])
    expect(crafted.mods[1].ways).toEqual([expect.objectContaining({ id: 'anoint' })])
    expect(crafted.needsItemLevel).toBeNull()
    expect(mod('(15-18)%').ways).toEqual([expect.objectContaining({ id: 'fractured', tone: 'bad' })])
    expect(mod('Grants a Free Lunch')).toMatchObject({ affix: null, ways: [] })
  })

  it('says when the item level of the build is too low for the tier', () => {
    const low = describeRare(rare('Zodiac Leather', [line('+42% to Fire Resistance')], { itemLevel: 30 }), BASES['Zodiac Leather'])
    expect(low.mods[0].ways.find((entry) => entry.id === 'roll')).toMatchObject({ tone: 'bad' })
    expect(low.mods[0].ways.map((entry) => entry.kind)).not.toContain('fossil')
  })

  it('offers to grow armour and jewellery on the Genesis Tree, with the passives for its modifiers', () => {
    const [genesis] = described.ways
    expect(genesis).toMatchObject({ id: 'genesis', kind: 'genesis' })
    expect(genesis.details[1]).toMatch(/^Пассивки поддерева Equipment под эту вещь: Increased Body Armour Chance, Guardian Flesh, More Dexterity Items, Increased Life Modifier Chance/)
    expect(genesis.details[1]).toMatch(/Increased Resistance Modifier Chance.*Modifier Tier Rating/)
    // Provisioning Wombgifts give armour and jewellery only: a bow cannot be grown.
    expect(describeRare(rare('Thicket Bow', [line('14% increased Attack Speed')]), BASES['Thicket Bow']).ways).toEqual([])
  })

  it('shows a two-stat modifier once', () => {
    const hybrid = Object.entries(MODS).find(
      ([, entry]) => entry.stats.length === 2 && !entry.source && spawnWeight(entry, itemTags(BASES['Zodiac Leather'], [])) > 0
    )![1]
    const both = describeRare(rare('Zodiac Leather', hybrid.stats.map((stat) => line(stat))), BASES['Zodiac Leather'])
    expect(both.mods).toHaveLength(1)
    expect(both.mods[0].text).toBe(hybrid.stats.join(' / '))
  })
})

describe('choosing a way', () => {
  it('lists rare items with their modifiers and remembers what the player picked', () => {
    const pob: PobBuild = {
      className: 'Ranger',
      ascendancy: null,
      level: 90,
      bandit: 'kill',
      skillSets: [],
      treeSpecs: [],
      itemSets: [{ title: 'Maps', items: [rare('Zodiac Leather', [line('+118 to maximum Life')])] }],
      notes: ''
    }
    const [shell] = buildSourcing(pob).special
    expect(shell.mods).toHaveLength(1)
    expect(shell.key).toContain('Doom Shell')

    const plan = new PlanStore(null)
    plan.importPob(encode(SAMPLE_XML))
    const bow = plan.view().sourcing!.special.find((item) => item.name === 'Doom Thirst')!
    const speed = bow.mods.find((mod) => mod.fractured)!
    plan.chooseWay(bow.key, 'nonsense')
    plan.chooseWay(`${bow.key}#${speed.key}`, 'fractured')
    const again = plan.view().sourcing!.special.find((item) => item.name === 'Doom Thirst')!
    // A way that does not exist is not shown as picked.
    expect(again.chosen).toBeNull()
    expect(again.mods.find((mod) => mod.fractured)!.chosen).toBe('fractured')
    plan.chooseWay(`${bow.key}#${speed.key}`, null)
    expect(plan.view().sourcing!.special.find((item) => item.name === 'Doom Thirst')!.mods.find((mod) => mod.fractured)!.chosen).toBeNull()

    const heart = plan.view().sourcing!.uniques[0]
    plan.chooseWay(heart.key, heart.ways[0].id)
    expect(plan.view().sourcing!.uniques[0].chosen).toBe(heart.ways[0].id)
  })
})
