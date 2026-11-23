import type { LootValue, RunView, SanctumTotals } from '@shared/sanctum'

export const EMPTY_LOOT: LootValue = { lines: [], gold: 0, chaos: 0, divine: null, unpriced: 0 }

/** Adds two lots of loot together, line by line. */
export function mergeLoot(a: LootValue | null, b: LootValue): LootValue {
  if (!a) return b
  const lines = new Map(a.lines.map((line) => [line.name, { ...line }]))
  for (const line of b.lines) {
    const known = lines.get(line.name)
    if (!known) {
      lines.set(line.name, { ...line })
    } else {
      known.count += line.count
      known.chaos = known.chaos === null && line.chaos === null ? null : (known.chaos ?? 0) + (line.chaos ?? 0)
    }
  }
  const merged = [...lines.values()].sort((x, y) => (y.chaos ?? -1) - (x.chaos ?? -1) || x.name.localeCompare(y.name))
  return {
    lines: merged,
    gold: a.gold + b.gold,
    chaos: a.chaos + b.chaos,
    divine: a.divine === null && b.divine === null ? null : (a.divine ?? 0) + (b.divine ?? 0),
    unpriced: merged.filter((line) => line.chaos === null).length
  }
}

const average = (values: number[]): number | null =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null

const countOf = (loot: LootValue, name: string): number => loot.lines.find((line) => line.name === name)?.count ?? 0

/** Statistics over finished runs; a run still in progress is left out. */
export function computeTotals(runs: RunView[]): SanctumTotals {
  const ended = runs.filter((run) => run.outcome !== 'active')
  const completed = ended.filter((run) => run.outcome === 'completed')
  const finishedFloors = ended.flatMap((run) => run.floors.filter((floor) => floor.done))
  const loot = ended.reduce<LootValue | null>((sum, run) => mergeLoot(sum, run.loot), null) ?? EMPTY_LOOT

  return {
    runs: ended.length,
    completed: completed.length,
    failed: ended.length - completed.length,
    avgRunMs: average(completed.map((run) => run.durationMs)),
    avgFloorMs: average(finishedFloors.map((floor) => floor.ms)),
    avgFloorMsByFloor: [1, 2, 3, 4].map((number) =>
      average(finishedFloors.filter((floor) => floor.floor === number).map((floor) => floor.ms))
    ),
    sanctumMs: ended.reduce((sum, run) => sum + run.durationMs, 0),
    chaos: loot.chaos,
    divine: loot.divine,
    gold: loot.gold,
    chaosOrbs: countOf(loot, 'Chaos Orb'),
    divineOrbs: countOf(loot, 'Divine Orb')
  }
}
