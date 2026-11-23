import { describe, expect, it } from 'vitest'
import { buildPlanRoute } from '../src/core/route/build'
import { labAdvice, orderNodes, treeAdvice } from '../src/core/tree/advice'
import { TREE, type PassiveTree, type TreeNode } from '../src/core/tree/data'
import { linkPattern, SEARCH_LIMIT, vendorSearches } from '../src/core/vendor'
import type { Fragment, PobBuild, PobGem, PobTreeSpec } from '../src/shared/plan'

/**
 * A small tree:
 *
 *   start(1) ─ 2 ─ 3 ─ [N 4] ─ (M 5)
 *      │
 *      6 ─ [N 7] ─ 8 ─ 9 ─ [K 10]
 *      │
 *     20 ─ [J 21]            30 ─ [N 31]   (an island the start does not reach)
 *
 *   ascendancy: A(100) ─ 101 ─ [N 102] ─ 103 ─ [N 104]
 *                 └──── 105 ─ [N 106]
 */
function sample(): PassiveTree {
  const nodes: Record<string, TreeNode> = {}
  const add = (id: number, kind: TreeNode['kind'], name: string, extra: Partial<TreeNode> = {}): void => {
    nodes[id] = { name, kind, links: [], ...extra }
  }
  const link = (a: number, b: number): void => {
    nodes[a].links.push(b)
    nodes[b].links.push(a)
  }
  add(1, 'start', 'RANGER', { classStart: 2 })
  add(2, 'small', 'Dexterity')
  add(3, 'small', 'Dexterity')
  add(4, 'notable', 'Ballistics', { stats: ['20% increased Projectile Damage'] })
  add(5, 'mastery', 'Bow Mastery', { effects: { 77: ['Arrows Pierce an additional Target'], 78: ['Other'] } })
  add(6, 'small', 'Life')
  add(7, 'notable', 'Heart of Oak')
  add(8, 'small', 'Evasion')
  add(9, 'small', 'Evasion')
  add(10, 'keystone', 'Acrobatics')
  add(20, 'small', 'Dexterity')
  add(21, 'jewel', 'Basic Jewel Socket')
  add(30, 'small', 'Strength')
  add(31, 'notable', 'Far Away')
  for (const [a, b] of [[1, 2], [2, 3], [3, 4], [4, 5], [1, 6], [6, 7], [7, 8], [8, 9], [9, 10], [6, 20], [20, 21], [30, 31]]) link(a, b)
  add(100, 'ascendancyStart', 'Deadeye', { ascendancy: 'Deadeye' })
  add(101, 'small', 'Projectile Damage', { ascendancy: 'Deadeye' })
  add(102, 'notable', 'Gathering Winds', { ascendancy: 'Deadeye' })
  add(103, 'small', 'Attack Speed', { ascendancy: 'Deadeye' })
  add(104, 'notable', 'Wind Ward', { ascendancy: 'Deadeye' })
  add(105, 'small', 'Mark Effect', { ascendancy: 'Deadeye' })
  add(106, 'notable', 'Focal Point', { ascendancy: 'Deadeye' })
  for (const [a, b] of [[100, 101], [101, 102], [102, 103], [103, 104], [100, 105], [105, 106], [100, 1]]) link(a, b)
  return { version: 'test', classes: [{ name: 'Scion', start: 999, ascendancies: [] }, { name: 'Ranger', start: 1, ascendancies: ['Deadeye'] }], nodes }
}

const spec = (title: string, nodeIds: number[], masteries: Record<number, number> = {}): PobTreeSpec => ({
  title,
  url: null,
  nodes: nodeIds.length,
  nodeIds,
  masteries
})

const build = (treeSpecs: PobTreeSpec[], extra: Partial<PobBuild> = {}): PobBuild => ({
  className: 'Ranger',
  ascendancy: 'Deadeye',
  level: 90,
  bandit: 'kill',
  skillSets: [],
  treeSpecs,
  itemSets: [],
  notes: '',
  ...extra
})

const tree = sample()
const FULL = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 20, 21]

describe('orderNodes', () => {
  it('goes for the nearest notable first and takes the path to it in order', () => {
    // Heart of Oak is two points away, Ballistics three: the nearer one comes first. Later the
    // keystone and Ballistics are equally far, and a keystone wins a tie.
    expect(orderNodes(FULL, [1], tree).sequence).toEqual([6, 7, 20, 21, 8, 9, 10, 2, 3, 4, 5])
  })

  it('continues from what is already owned', () => {
    expect(orderNodes(FULL, [1, 2, 3], tree).sequence.slice(0, 2)).toEqual([4, 5])
  })

  it('never walks through nodes the target does not have', () => {
    // Without node 8 the keystone cannot be reached, however much it is wanted.
    const result = orderNodes([1, 6, 7, 9, 10], [1], tree)
    expect(result.sequence).toEqual([6, 7])
    expect(result.unreachable).toEqual([9, 10])
  })

  it('takes leftover travel nodes last and ignores ids the tree does not know', () => {
    expect(orderNodes([2, 3, 555], [1], tree)).toEqual({ sequence: [2, 3], unreachable: [] })
  })
})

describe('treeAdvice', () => {
  const stages = build([spec('Final', FULL, { 5: 77 }), spec('Act 3', [1, 6, 7, 2, 3, 4])])

  it('follows the smallest tree first, from the class start while nothing is known', () => {
    const advice = treeAdvice(stages, 'Ranger', null, null, tree)!
    expect(advice).toMatchObject({ specIndex: 1, specTitle: 'Act 3', stages: [1, 0], taken: 0, total: 5, known: false, more: 0 })
    expect(advice.next.map((point) => point.name)).toEqual(['Life', 'Heart of Oak', 'Dexterity', 'Dexterity', 'Ballistics'])
  })

  it('moves on to the next tree once the first is taken', () => {
    const advice = treeAdvice(stages, 'Ranger', { hashes: [6, 7, 2, 3, 4] }, null, tree)!
    expect(advice).toMatchObject({ specIndex: 0, taken: 5, total: 11, known: true })
    // The mastery next to the notable just taken is one point away.
    expect(advice.next[0]).toEqual({ id: 5, name: 'Bow Mastery', kind: 'mastery', stats: ['Arrows Pierce an additional Target'] })
  })

  it('follows the tree the player pinned', () => {
    expect(treeAdvice(stages, 'Ranger', null, 0, tree)).toMatchObject({ specIndex: 0, total: 11 })
    expect(treeAdvice(stages, 'Ranger', null, 7, tree)).toMatchObject({ specIndex: 1 })
  })

  it('points out nodes the character has that the build does not', () => {
    const advice = treeAdvice(build([spec('Only', [1, 2, 3, 4])]), 'Ranger', { hashes: [2, 6] }, null, tree)!
    expect(advice.extra.map((point) => point.id)).toEqual([6])
    expect(advice.taken).toBe(1)
    expect(advice.next.map((point) => point.id)).toEqual([3, 4])
  })

  it('reports what it cannot connect and says when the tree is complete', () => {
    expect(treeAdvice(build([spec('Island', [1, 2, 30, 31])]), 'Ranger', null, null, tree)).toMatchObject({ unreachable: 2 })
    const done = treeAdvice(build([spec('Small', [1, 2])]), 'Ranger', { hashes: [2] }, null, tree)!
    expect(done).toMatchObject({ taken: 1, total: 1, next: [] })
  })

  it('gives nothing without a tree or a known class', () => {
    expect(treeAdvice(build([]), 'Ranger', null, null, tree)).toBeNull()
    expect(treeAdvice(build([spec('x', FULL)]), null, null, null, tree)).toBeNull()
  })
})

describe('labAdvice', () => {
  it('splits the ascendancy points over the Labyrinths, two each', () => {
    const labs = labAdvice(build([spec('Final', [...FULL, 100, 101, 102, 103, 104, 105, 106])]), tree)
    expect(labs.map((lab) => `${lab.lab}: ${lab.nodes.map((node) => node.name).join(' + ')}`)).toEqual([
      'normal: Projectile Damage + Gathering Winds',
      'cruel: Attack Speed + Wind Ward',
      'merciless: Mark Effect + Focal Point'
    ])
  })

  it('takes the order from the stage trees where the build has them', () => {
    const labs = labAdvice(
      build([spec('Final', [1, 2, 3, 100, 101, 102, 105, 106]), spec('After the first lab', [1, 2, 100, 105, 106])]),
      tree
    )
    expect(labs[0].nodes.map((node) => node.name)).toEqual(['Mark Effect', 'Focal Point'])
    expect(labs[1].nodes.map((node) => node.name)).toEqual(['Projectile Damage', 'Gathering Winds'])
  })

  it('gives nothing for a build without an ascendancy', () => {
    expect(labAdvice(build([spec('x', FULL)], { ascendancy: null }), tree)).toEqual([])
  })

  it('adds the points and a level to the Labyrinth steps of the route', () => {
    const labs = labAdvice(build([spec('Final', [1, 2, 100, 101, 102])]), tree)
    const route = buildPlanRoute({ bandit: 'kill', leagueStart: true, library: false }, null, undefined, labs).steps
    const hint = (lab: string): string[] =>
      route
        .find((step) => step.parts.some((part) => part.type === 'ascend' && part.lab === lab))!
        .subSteps.map((parts: Fragment[]) => parts.map((part) => ('text' in part ? part.text : '')).join(''))
    expect(hint('normal')).toEqual(['Очки возвышения: Projectile Damage и Gathering Winds', 'Рекомендуемый уровень: 33+'])
    expect(hint('cruel')).toEqual(['Рекомендуемый уровень: 55+'])
  })
})

describe('the real tree', () => {
  it('has a start for every class and links that go both ways', () => {
    expect(TREE.classes.map((entry) => entry.name).sort()).toEqual(
      ['Duelist', 'Marauder', 'Ranger', 'Scion', 'Shadow', 'Templar', 'Witch']
    )
    for (const entry of TREE.classes) expect(TREE.nodes[entry.start]?.kind).toBe('start')
    for (const [id, node] of Object.entries(TREE.nodes)) {
      for (const link of node.links) expect(TREE.nodes[link].links, `${id} ↔ ${link}`).toContain(+id)
    }
  })

  it('lets a mastery be reached from the notables of its cluster', () => {
    const masteries = Object.values(TREE.nodes).filter((node) => node.kind === 'mastery')
    expect(masteries.length).toBeGreaterThan(100)
    // A few masteries of the data belong to no cluster of the current tree: those have no links.
    const placed = masteries.filter((mastery) => mastery.links.length > 0)
    expect(placed.length).toBeGreaterThan(300)
    for (const mastery of placed) {
      expect(mastery.links.some((id) => TREE.nodes[id].kind === 'notable'), mastery.name).toBe(true)
    }
  })

  it('orders a walk from the Ranger start through real nodes', () => {
    const start = TREE.classes.find((entry) => entry.name === 'Ranger')!.start
    // Everything within four steps of the start.
    const near = new Set([start])
    for (let i = 0; i < 4; i++) for (const id of [...near]) for (const link of TREE.nodes[id].links) {
      if (!TREE.nodes[link].ascendancy) near.add(link)
    }
    const { sequence, unreachable } = orderNodes(near, [start])
    expect(unreachable).toEqual([])
    expect(sequence).toHaveLength(near.size - 1)
    // Every point taken touches something taken before it.
    const owned = new Set([start])
    for (const id of sequence) {
      expect(TREE.nodes[id].links.some((link) => owned.has(link))).toBe(true)
      owned.add(id)
    }
  })
})

describe('vendor searches', () => {
  const gem = (name: string, attribute: PobGem['attribute'], support: boolean, id: string | null = 'Metadata/Items/Gems/SkillGemToxicRain'): PobGem => ({
    id,
    name,
    baseName: null,
    level: 1,
    attribute,
    support
  })

  it('lists every order of the colours while that fits the search box', () => {
    expect(linkPattern(['g', 'g', 'r'])).toEqual({ pattern: 'g-g-r|g-r-g|r-g-g', exact: true })
    expect(linkPattern(['b', 'b', 'b', 'b'])).toEqual({ pattern: 'b-b-b-b', exact: true })
    expect(linkPattern(['g', '.'])).toEqual({ pattern: '.-g|g-.', exact: true })
  })

  it('falls back to "any of these colours" when the exact string would be too long', () => {
    const { pattern, exact } = linkPattern(['r', 'r', 'g', 'b'])
    expect(exact).toBe(false)
    expect(pattern).toBe('[bgr]-[bgr]-[bgr]-[bgr]')
    expect(pattern.length).toBeLessThanOrEqual(SEARCH_LIMIT)
  })

  it('asks for three links early and four from level 25, only for groups with supports', () => {
    const pob = build([], {
      skillSets: [
        {
          title: 'Acts',
          groups: [
            { label: 'Auras', slot: null, gems: [gem('Grace', 'dexterity', false), gem('Hatred', 'dexterity', false)] },
            {
              label: 'Main',
              slot: null,
              gems: [
                gem('Mirage Archer', 'dexterity', true),
                gem('Toxic Rain', 'dexterity', false),
                gem('Void Manipulation', 'intelligence', true),
                gem('Efficacy', 'intelligence', true)
              ]
            },
            { label: 'Unknown', slot: null, gems: [gem('Future', 'strength', false, null), gem('Future Support', 'strength', true, null)] }
          ]
        }
      ]
    })
    const early = vendorSearches(pob, [0], 12)
    expect(early.map((search) => search.pattern)).toEqual(['b-g-g|g-b-g|g-g-b', '"movement speed"'])
    expect(early[0].label).toBe('Связка под Toxic Rain: G-G-B')
    expect(vendorSearches(pob, [0], 30)[0]).toMatchObject({ label: 'Связка под Toxic Rain: G-G-B-B', note: null })
    // A set that is not collected in the campaign adds nothing.
    expect(vendorSearches(pob, [], 30).map((search) => search.pattern)).toEqual(['"movement speed"'])
    for (const search of vendorSearches(pob, [0], 30)) expect(search.pattern.length).toBeLessThanOrEqual(SEARCH_LIMIT)
  })
})
