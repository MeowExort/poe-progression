import type { LootLine, LootValue, RunView, SanctumTotals } from '@shared/sanctum'

export const EMPTY_LOOT: LootValue = { lines: [], gold: 0, chaos: 0, divine: null, unpriced: 0 }

/** Adds two lots of loot together, line by line. */
export function mergeLoot(a: LootValue | null, b: LootValue): LootValue {
  if (!a) return b
  // Relics are kept apart by item; everything else adds up by name.
  const keyOf = (line: LootLine): string => (line.relic ? `relic:${line.relic.itemId}` : line.name)
  const lines = new Map(a.lines.map((line) => [keyOf(line), { ...line }]))
  for (const line of b.lines) {
    const known = lines.get(keyOf(line))
    if (!known) {
      lines.set(keyOf(line), { ...line })
    } else {
      known.count += line.count
      known.chaos = known.chaos === null && line.chaos === null ? null : (known.chaos ?? 0) + (line.chaos ?? 0)
      // Either side may know more about the item than the other (older records know less).
      known.currency = known.currency || line.currency
      known.icon = known.icon ?? line.icon
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


/** Statistics over finished runs; a run still in progress is left out. */
export function computeTotals(runs: RunView[]): SanctumTotals {
  const ended = runs.filter((run) => run.outcome !== 'active')
  const completed = ended.filter((run) => run.outcome === 'completed')
  const finishedFloors = ended.flatMap((run) => run.floors.filter((floor) => floor.done))
  const loot = ended.reduce<LootValue | null>((sum, run) => mergeLoot(sum, run.loot), null) ?? EMPTY_LOOT
  // Of equals the earlier run keeps the record.
  const richest = ended.reduce<RunView | null>((best, run) => (run.loot.chaos > (best?.loot.chaos ?? 0) ? run : best), null)
  const fastest = completed.reduce<RunView | null>((best, run) => (!best || run.durationMs < best.durationMs ? run : best), null)

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
    currency: currencyCounts(loot),
    richest: richest && { runId: richest.id, startedAt: richest.startedAt, chaos: richest.loot.chaos, divine: richest.loot.divine },
    fastest: fastest && { runId: fastest.id, startedAt: fastest.startedAt, durationMs: fastest.durationMs }
  }
}

/** How many of each currency item the loot holds, by name. */
export function currencyCounts(loot: LootValue): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const line of loot.lines) if (line.currency) counts[line.name] = line.count
  return counts
}

/** Recomputes the sums of a loot after one of its lines changed price. */
export function retotal(loot: LootValue, divineChaos: number | null): LootValue {
  const chaos = loot.lines.reduce((sum, line) => sum + (line.chaos ?? 0), 0)
  const lines = [...loot.lines].sort((x, y) => (y.chaos ?? -1) - (x.chaos ?? -1) || x.name.localeCompare(y.name))
  return {
    ...loot,
    lines,
    chaos,
    divine: divineChaos ? chaos / divineChaos : loot.divine,
    unpriced: lines.filter((line) => line.chaos === null).length
  }
}
