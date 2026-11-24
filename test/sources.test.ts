import { describe, expect, it } from 'vitest'
import { buildSourcing } from '../src/core/sources'
import type { PobBuild, PobItem } from '../src/shared/plan'

const item = (patch: Partial<PobItem> & Pick<PobItem, 'name'>): PobItem => ({
  slot: 'Body Armour',
  base: null,
  rarity: 'RARE',
  links: 0,
  influences: [],
  craftedMods: [],
  fractured: false,
  corrupted: false,
  itemLevel: null,
  mods: [],
  ...patch
})

const build = (sets: Record<string, PobItem[]>): PobBuild => ({
  className: 'Ranger',
  ascendancy: 'Deadeye',
  level: 90,
  bandit: 'kill',
  skillSets: [],
  treeSpecs: [],
  itemSets: Object.entries(sets).map(([title, items]) => ({ title, items })),
  notes: ''
})

const unique = (name: string, base: string, patch: Partial<PobItem> = {}): PobItem =>
  item({ name, base, rarity: 'UNIQUE', ...patch })

const texts = (sourcing: { notes: { text: string }[] }): string => sourcing.notes.map((note) => note.text).join('\n')
/** Everything a way says, on one line per way: "id | title | details". */
const ways = (sourcing: { ways: { id: string; title: string; details: string[] }[] }): string =>
  sourcing.ways.map((way) => `${way.id} | ${way.title} | ${way.details.join(' ')}`).join('\n')

describe('buildSourcing: uniques', () => {
  it('suggests an Orb of Chance on the base for an ordinary drop and lists its divination cards', () => {
    const { uniques, methods } = buildSourcing(build({ Maps: [unique("Kaom's Heart", 'Glorious Plate')] }))
    expect(uniques).toHaveLength(1)
    const [kaom] = uniques
    // Every way is listed side by side, for the player to pick from.
    expect(kaom.ways.map((way) => way.id)).toEqual(['drop', 'chance', 'card:Pride Before the Fall', "card:The King's Heart", 'genesis'])
    expect(ways(kaom)).toMatch(/drop \| Обычный дроп/)
    expect(ways(kaom)).toMatch(/Orb of Chance на белую Glorious Plate \| Нужна обычная \(белая\) Glorious Plate — база с \d+ уровня/)
    expect(ways(kaom)).toMatch(/Карты предсказаний: The King's Heart \| Набор из 8 шт\. даёт Kaom's Heart/)
    expect(kaom).toMatchObject({ chosen: null, mods: [], key: expect.stringContaining("Kaom's Heart") })
    expect(kaom.methods).toEqual(['chance-orb', 'genesis-tree'])
    expect(kaom.wikiUrl).toBe("https://www.poewiki.net/wiki/Kaom's_Heart")
    expect(methods.map((method) => method.id)).toEqual(['chance-orb', 'item-tiers', 'genesis-tree'])
  })

  it('names the Genesis Tree passives that steer towards the slot of the unique', () => {
    const [kaom] = buildSourcing(build({ Maps: [unique("Kaom's Heart", 'Glorious Plate')] })).uniques
    const genesis = kaom.ways.find((way) => way.id === 'genesis')!
    expect(genesis.title).toMatch(/Ancient Wombgift/)
    expect(genesis.details[1]).toBe(
      'Пассивки поддерева Unique Items под этот уник: Increased Body Armour Chance, Guardian Lineage, More Strength Items, Cleansed of Impurity, Recessive Genes.'
    )
    expect(genesis.details.join(' ')).toMatch(/в моих данных нет/)
    // A weapon goes by its kind; a Foulborn version wants the passives that make uniques Foulborn.
    const [bow] = buildSourcing(build({ Maps: [unique("Foulborn Death's Harp", 'Death Bow', { slot: 'Weapon 1' })] })).uniques
    expect(bow.ways.find((way) => way.id === 'genesis')!.details[1]).toMatch(
      /Increased Ranged Weapons Chance, Martial Lineage, More Dexterity Items, Foulborn Ancestry, Corrupted Flesh, Recessive Genes/
    )
  })

  it('reports a boss drop as the source and does not suggest chancing it', () => {
    const [starforge] = buildSourcing(build({ Maps: [unique('Starforge', 'Infernal Sword')] })).uniques
    expect(ways(starforge)).toMatch(/drop \| Дроп: Drops from The Shaper/)
    expect(starforge.ways.map((way) => way.kind)).not.toContain('chance')
    expect(starforge.methods).toEqual(['genesis-tree'])
  })

  it('flags league uniques instead of calling them an ordinary drop', () => {
    const [soulwrest] = buildSourcing(build({ Maps: [unique('Soulwrest', 'Ezomyte Staff')] })).uniques
    expect(ways(soulwrest)).toMatch(/Уник лиги Delve/)
    expect(ways(soulwrest)).not.toMatch(/Обычный дроп/)
    expect(soulwrest.ways.map((way) => way.kind)).not.toContain('chance')
  })

  it('says so when a unique can no longer be obtained', () => {
    const [wall] = buildSourcing(build({ Maps: [unique('Wall of Brambles', 'Plate Vest')] })).uniques
    expect(wall.notes).toEqual([expect.objectContaining({ tone: 'bad', text: expect.stringMatching(/получить нельзя/) })])
    expect(wall.ways).toEqual([])
  })

  it('admits when it knows nothing about a unique', () => {
    const [unknown] = buildSourcing(build({ Maps: [unique('Totally New Unique', 'Astral Plate')] })).uniques
    expect(texts(unknown)).toMatch(/нет в данных Path of Building/)
    expect(unknown.base).toBe('Astral Plate')
  })

  it('looks up a Foulborn unique under its regular name', () => {
    const [foulborn] = buildSourcing(build({ Maps: [unique("Foulborn Kaom's Heart", 'Glorious Plate')] })).uniques
    expect(texts(foulborn)).toMatch(/Foulborn-версия/)
    expect(ways(foulborn)).toMatch(/Карты предсказаний: The King's Heart/)
  })

  it('describes an item once and lists every set that uses it', () => {
    const heart = unique("Kaom's Heart", 'Glorious Plate')
    const { uniques } = buildSourcing(build({ Early: [heart], Endgame: [{ ...heart, links: 6 }] }))
    expect(uniques).toHaveLength(1)
    expect(uniques[0].usedIn).toEqual(['Body Armour · Early', 'Body Armour · Endgame'])
    expect(texts(uniques[0])).toMatch(/6 связей/)
  })
})

describe('buildSourcing: other items', () => {
  it('leaves plain rares out', () => {
    const { special, methods } = buildSourcing(build({ Maps: [item({ name: 'Doom Shell', base: 'Astral Plate' })] }))
    expect(special).toEqual([])
    expect(methods.map((method) => method.id)).toEqual(['item-tiers'])
  })

  it('lists six-link cards for the base and for its item class', () => {
    const plate = item({ name: 'Doom Shell', base: 'Astral Plate', links: 6 })
    const [described] = buildSourcing(build({ Maps: [plate] })).special
    const text = texts(described)
    expect(text).toMatch(/База: Astral Plate \(Body Armour\)/)
    expect(text).toMatch(/Нужно 6 связей/)
    expect(text).toMatch(/Карта The Celestial Justicar/)
    expect(text).toMatch(/Карта The Chains that Bind/)
    expect(text).not.toMatch(/The Dark Mage/)
    expect(described.methods).toContain('item-tiers')
  })

  it('does not offer six-link cards for a five-link', () => {
    const plate = item({ name: 'Doom Shell', base: 'Astral Plate', links: 5 })
    expect(texts(buildSourcing(build({ Maps: [plate] })).special[0])).not.toMatch(/Карта/)
  })

  it('notes influence, fractured mods and bench crafts', () => {
    const bow = item({
      slot: 'Weapon 1',
      name: 'Doom Thirst',
      base: 'Spine Bow',
      influences: ['Shaper', 'Hunter'],
      fractured: true,
      craftedMods: ['+(20-25)% to Global Critical Strike Multiplier', 'Allocates Corruption']
    })
    const { special, methods } = buildSourcing(build({ Maps: [bow] }))
    const text = texts(special[0])
    expect(text).toMatch(/Влияние: Shaper, Hunter/)
    expect(text).toMatch(/fractured-мод/)
    expect(text).toMatch(/Крафт или зачарование: \+\(20-25\)% to Global Critical Strike Multiplier$/m)
    expect(text).toMatch(/Анойнт маслами: Corruption$/m)
    expect(methods.map((method) => method.id)).toEqual(['item-tiers', 'fractured'])
  })

  it('backs every method with quotes and a link to the patch notes', () => {
    const bow = item({ name: 'Doom Thirst', base: 'Spine Bow', fractured: true })
    const { methods } = buildSourcing(build({ Maps: [bow, unique("Kaom's Heart", 'Glorious Plate')] }))
    expect(methods.map((method) => method.id).sort()).toEqual(['chance-orb', 'fractured', 'genesis-tree', 'item-tiers'])
    for (const method of methods) {
      expect(method.quotes.length).toBeGreaterThan(0)
      expect(method.ref.url).toMatch(/^https:\/\/www\.pathofexile\.com\/forum\/view-thread\//)
    }
  })
})
