import { describe, expect, it } from 'vitest'
import { computeTotals, EMPTY_LOOT } from '../src/core/sanctum/stats'
import type { RunView } from '../src/shared/sanctum'

const run = (id: number, outcome: RunView['outcome'], durationMs: number, chaos: number): RunView => ({
  id,
  sessionId: 1,
  startedAt: id,
  endedAt: id + durationMs,
  outcome,
  floors: [],
  transitMs: 0,
  durationMs,
  loot: { ...EMPTY_LOOT, chaos, divine: chaos / 200 },
  lootNote: null
})

describe('records among Sanctum runs', () => {
  it('names the run with the most loot and the fastest completed run', () => {
    const totals = computeTotals([
      run(1000, 'completed', 700_000, 150),
      run(2000, 'failed', 90_000, 900),
      run(3000, 'completed', 640_000, 40),
      run(4000, 'completed', 800_000, 0)
    ])
    // A failed run can be the richest, but never the fastest: it is short for the wrong reason.
    expect(totals.richest).toEqual({ runId: 2000, startedAt: 2000, chaos: 900, divine: 4.5 })
    expect(totals.fastest).toEqual({ runId: 3000, startedAt: 3000, durationMs: 640_000 })
  })

  it('keeps the earlier run when two are equal', () => {
    const totals = computeTotals([run(1000, 'completed', 600_000, 50), run(2000, 'completed', 600_000, 50)])
    expect(totals.richest?.runId).toBe(1000)
    expect(totals.fastest?.runId).toBe(1000)
  })

  it('has no records without loot or without a completed run, and ignores the run in progress', () => {
    const totals = computeTotals([run(1000, 'failed', 90_000, 0), run(2000, 'active', 10_000, 500)])
    expect(totals.richest).toBeNull()
    expect(totals.fastest).toBeNull()
    expect(computeTotals([])).toMatchObject({ richest: null, fastest: null })
  })
})
