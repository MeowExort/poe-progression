import type { CharacterClass, LabAdvice, PobBuild, PobTreeSpec, TreeAdvice, TreePoint } from '@shared/plan'
import { TREE, type PassiveTree } from './data'

/** How many of the next points the advice lists. */
const POINTS_SHOWN = 12
const EXTRA_SHOWN = 10
const LABS: LabAdvice['lab'][] = ['normal', 'cruel', 'merciless', 'eternal']
/** Among goals equally far away: what to reach first. */
const GOAL_RANK: Record<string, number> = { keystone: 0, notable: 1, mastery: 2, jewel: 3 }

/**
 * Puts the nodes of a target tree in an order they can be taken in, starting from what is
 * owned. Path of Building does not record the order a build was allocated in, so this picks
 * one: always go for the nearest notable, keystone, mastery or jewel socket that is left.
 * Nodes of the target that cannot be reached from the owned ones are returned apart.
 */
export function orderNodes(
  target: Iterable<number>,
  start: Iterable<number>,
  tree: PassiveTree = TREE
): { sequence: number[]; unreachable: number[] } {
  const exists = (id: number): boolean => tree.nodes[id] !== undefined
  const owned = new Set([...start].filter(exists))
  const allowed = new Set([...target].filter(exists))
  for (const id of owned) allowed.add(id)
  const sequence: number[] = []

  /** Breadth-first from everything owned, over the allowed nodes: steps to each and how it was reached. */
  const reach = (): { order: number[]; from: Map<number, number>; steps: Map<number, number> } => {
    const steps = new Map<number, number>()
    const from = new Map<number, number>()
    const order: number[] = []
    let frontier = [...owned].sort((a, b) => a - b)
    for (const id of frontier) steps.set(id, 0)
    while (frontier.length) {
      const next: number[] = []
      for (const id of frontier) {
        for (const link of tree.nodes[id].links) {
          if (!allowed.has(link) || steps.has(link)) continue
          steps.set(link, steps.get(id)! + 1)
          from.set(link, id)
          order.push(link)
          next.push(link)
        }
      }
      frontier = next
    }
    return { order, from, steps }
  }

  for (;;) {
    const { order, from, steps } = reach()
    const goals = order.filter((id) => GOAL_RANK[tree.nodes[id].kind] !== undefined)
    if (!goals.length) {
      // Only travel nodes are left: take them as they come.
      for (const id of order) {
        sequence.push(id)
        owned.add(id)
      }
      break
    }
    goals.sort(
      (a, b) =>
        steps.get(a)! - steps.get(b)! || GOAL_RANK[tree.nodes[a].kind] - GOAL_RANK[tree.nodes[b].kind] || a - b
    )
    const path: number[] = []
    for (let id: number | undefined = goals[0]; id !== undefined && !owned.has(id); id = from.get(id)) path.unshift(id)
    for (const id of path) {
      sequence.push(id)
      owned.add(id)
    }
  }
  return { sequence, unreachable: [...allowed].filter((id) => !owned.has(id)).sort((a, b) => a - b) }
}

function point(id: number, spec: PobTreeSpec | null, tree: PassiveTree): TreePoint {
  const node = tree.nodes[id]
  const effect = node.kind === 'mastery' ? spec?.masteries[id] : undefined
  return {
    id,
    name: node.name,
    kind: node.kind === 'start' || node.kind === 'ascendancyStart' ? 'small' : node.kind,
    stats: (effect !== undefined ? node.effects?.[effect] : node.stats) ?? []
  }
}

const mainNodes = (spec: PobTreeSpec, tree: PassiveTree): number[] =>
  spec.nodeIds.filter((id) => {
    const node = tree.nodes[id]
    return node !== undefined && node.ascendancy === undefined && node.kind !== 'start'
  })

/** The build's trees from the smallest to the largest: stage trees come before the final one. */
function stages(specs: PobTreeSpec[], tree: PassiveTree): number[] {
  return specs
    .map((spec, index) => ({ index, size: mainNodes(spec, tree).length }))
    .filter((entry) => entry.size > 0)
    .sort((a, b) => a.size - b.size || a.index - b.index)
    .map((entry) => entry.index)
}

export interface AllocatedTree {
  /** Ids of the nodes the character has. */
  hashes: number[]
}

/**
 * What to put passive points into next. Follows the build's trees from the smallest up
 * (or the one the player pinned) and starts from what the character already has; while that
 * is unknown, from the class start.
 */
export function treeAdvice(
  pob: PobBuild,
  characterClass: CharacterClass | null,
  allocated: AllocatedTree | null,
  pinned: number | null,
  tree: PassiveTree = TREE
): TreeAdvice | null {
  const order = stages(pob.treeSpecs, tree)
  const start = tree.classes.find((entry) => entry.name === characterClass)?.start
  if (!order.length || start === undefined) return null

  const owned = new Set(
    (allocated?.hashes ?? []).filter((id) => tree.nodes[id] !== undefined && tree.nodes[id].ascendancy === undefined)
  )
  const remaining = (index: number): number => mainNodes(pob.treeSpecs[index], tree).filter((id) => !owned.has(id)).length
  const specIndex =
    pinned !== null && order.includes(pinned) ? pinned : (order.find((index) => remaining(index) > 0) ?? order[order.length - 1])
  const spec = pob.treeSpecs[specIndex]
  const target = mainNodes(spec, tree)
  const { sequence, unreachable } = orderNodes(target, [start, ...owned], tree)

  const planned = new Set(pob.treeSpecs.flatMap((entry) => entry.nodeIds))
  const extra = [...owned].filter((id) => !planned.has(id)).sort((a, b) => a - b)
  return {
    specIndex,
    specTitle: spec.title,
    stages: order,
    taken: target.filter((id) => owned.has(id)).length,
    total: target.length,
    next: sequence.slice(0, POINTS_SHOWN).map((id) => point(id, spec, tree)),
    more: Math.max(0, sequence.length - POINTS_SHOWN),
    unreachable: unreachable.length,
    extra: extra.slice(0, EXTRA_SHOWN).map((id) => point(id, null, tree)),
    known: allocated !== null
  }
}

/**
 * The ascendancy nodes of the build split over the four Labyrinths, two points each. The
 * order follows the build's stage trees where they differ, otherwise the nearest notable.
 */
export function labAdvice(pob: PobBuild, tree: PassiveTree = TREE): LabAdvice[] {
  const name = pob.ascendancy
  if (!name) return []
  const root = Object.keys(tree.nodes).find((id) => tree.nodes[id].kind === 'ascendancyStart' && tree.nodes[id].ascendancy === name)
  if (root === undefined) return []

  const sequence: number[] = []
  let last: PobTreeSpec | null = null
  for (const index of stages(pob.treeSpecs, tree)) {
    const spec = pob.treeSpecs[index]
    const target = spec.nodeIds.filter((id) => tree.nodes[id]?.ascendancy === name && tree.nodes[id].kind !== 'ascendancyStart')
    if (!target.length) continue
    sequence.push(...orderNodes(target, [+root, ...sequence], tree).sequence)
    last = spec
  }
  const labs: LabAdvice[] = []
  for (let i = 0; i < LABS.length && i * 2 < sequence.length; i++) {
    labs.push({ lab: LABS[i], nodes: sequence.slice(i * 2, i * 2 + 2).map((id) => point(id, last, tree)) })
  }
  return labs
}
