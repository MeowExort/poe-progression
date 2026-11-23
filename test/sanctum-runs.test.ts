import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { classifyArea, SanctumTracker, type Boundary, type TrackedRun } from '../src/core/sanctum/runs'
import { parseLine } from '../src/main/log/parser'

const at = (time: string): number => {
  const [h, m, s] = time.split(':').map(Number)
  return new Date(2026, 10, 23, h, m, s).getTime()
}

function track() {
  const finished: TrackedRun[] = []
  const boundaries: Boundary[] = []
  const tracker = new SanctumTracker({
    onRun: (run) => {
      if (run.outcome !== 'active') finished.push(structuredClone(run))
    },
    onBoundary: (boundary) => boundaries.push(boundary)
  })
  return { tracker, finished, boundaries }
}

/** Replays log lines through the real parser into a tracker. */
function replay(tracker: SanctumTracker, lines: string[]): void {
  for (const line of lines) {
    const parsed = parseLine(line)
    if (parsed.kind !== 'event') continue
    const event = parsed.event
    if (event.type === 'area_generated') tracker.area(event.ts, event.areaId, event.seed)
    if (event.type === 'dialogue') tracker.dialogue(event.ts, event.speaker, event.text)
  }
}

const realRun = readFileSync(join(__dirname, 'fixtures/sanctum-run.txt'), 'utf8').split(/\r?\n/)

describe('classifyArea', () => {
  it('tells the lobby, floor entrances, rooms and everything else apart', () => {
    expect(classifyArea('SanctumFoyer_Fellshrine')).toEqual({ kind: 'lobby' })
    expect(classifyArea('SanctumFoyer_2_3')).toEqual({ kind: 'entrance', floor: 2 })
    expect(classifyArea('SanctumCellar')).toEqual({ kind: 'room', floor: 1 })
    expect(classifyArea('SanctumCrypt')).toEqual({ kind: 'room', floor: 4 })
    expect(classifyArea('HideoutSpace')).toEqual({ kind: 'outside' })
  })
})

describe('a real completed run', () => {
  const { tracker, finished, boundaries } = track()
  replay(tracker, realRun)
  const [run] = finished

  it('is recognised as one completed run', () => {
    expect(finished).toHaveLength(1)
    expect(run).toMatchObject({ outcome: 'completed', startedAt: at('13:35:32'), endedAt: at('13:47:13') })
    expect(tracker.active).toBeNull()
  })

  it('has four floors of eight rooms, all done', () => {
    expect(run.floors.map((floor) => [floor.floor, floor.rooms, floor.done])).toEqual([
      [1, 8, true],
      [2, 8, true],
      [3, 8, true],
      [4, 8, true]
    ])
  })

  it('times each floor from its entrance to leaving its last room', () => {
    expect(run.floors.map((floor) => floor.ms / 1000)).toEqual([139, 155, 164, 230])
    expect(run.transitMs / 1000).toBe(13)
    const total = run.floors.reduce((sum, floor) => sum + floor.ms, 0) + run.transitMs
    expect(total).toBe(run.endedAt! - run.startedAt)
  })

  it('asks for the inventory at the start and at the end of every floor', () => {
    expect(boundaries.map((boundary) => `${boundary.kind} ${boundary.floor}`)).toEqual([
      'baseline 1',
      'collect 1',
      'collect 2',
      'collect 3',
      'collect 4'
    ])
    expect(new Set(boundaries.map((boundary) => boundary.runId))).toEqual(new Set([run.id]))
  })
})

describe('SanctumTracker', () => {
  const enter = (tracker: SanctumTracker, time: string, areaId: string, seed = time) => tracker.area(at(time), areaId, seed)

  /** Plays floor 1 up to `rooms` rooms, starting at 10:00:00, ten seconds a room. */
  function floorOne(tracker: SanctumTracker, rooms: number, seed = 'run-a'): void {
    enter(tracker, '10:00:00', 'SanctumFoyer_1_1', seed)
    for (let i = 0; i < rooms; i++) enter(tracker, `10:00:${String(10 + i * 10).padStart(2, '0')}`, 'SanctumCellar', `${seed}-room-${i}`)
  }

  it('ignores the lobby and other areas until a run starts on floor 1', () => {
    const { tracker, finished, boundaries } = track()
    enter(tracker, '09:00:00', 'HideoutSpace')
    enter(tracker, '09:00:10', 'SanctumFoyer_Fellshrine')
    expect(tracker.active).toBeNull()
    expect([finished, boundaries]).toEqual([[], []])
  })

  it('does not join a run halfway through', () => {
    const { tracker } = track()
    enter(tracker, '09:00:00', 'SanctumFoyer_3_2')
    enter(tracker, '09:00:10', 'SanctumNave')
    expect(tracker.active).toBeNull()
  })

  it('counts a run as failed when a new one starts with a different entrance', () => {
    const { tracker, finished } = track()
    floorOne(tracker, 3)
    enter(tracker, '10:00:45', 'HideoutSpace')
    enter(tracker, '10:02:00', 'SanctumFoyer_Fellshrine')
    enter(tracker, '10:02:10', 'SanctumFoyer_1_2', 'run-b')
    expect(finished).toHaveLength(1)
    expect(finished[0]).toMatchObject({ outcome: 'failed', endedAt: at('10:02:10') })
    expect(finished[0].floors).toEqual([{ floor: 1, rooms: 3, ms: 45_000, done: false }])
    expect(tracker.active?.run.id).toBe(at('10:02:10'))
  })

  it('counts a run as failed when the next one starts while it was on a later floor', () => {
    const { tracker, finished } = track()
    floorOne(tracker, 8)
    enter(tracker, '10:01:40', 'SanctumFoyer_Fellshrine')
    enter(tracker, '10:01:45', 'SanctumFoyer_2_1', 'run-a-2')
    enter(tracker, '10:02:00', 'SanctumVaults')
    enter(tracker, '10:03:00', 'SanctumFoyer_Fellshrine')
    enter(tracker, '10:03:10', 'SanctumFoyer_1_1', 'run-a')
    expect(finished.map((run) => run.outcome)).toEqual(['failed'])
    expect(finished[0].floors.map((floor) => floor.done)).toEqual([true, false])
  })

  it('treats coming back through the same entrance as the same run, and does not time the break', () => {
    const { tracker, finished, boundaries } = track()
    floorOne(tracker, 2)
    enter(tracker, '10:00:30', 'HideoutSpace')
    enter(tracker, '10:05:00', 'SanctumFoyer_Fellshrine')
    enter(tracker, '10:05:10', 'SanctumFoyer_1_1', 'run-a')
    enter(tracker, '10:05:20', 'SanctumCellar', 'run-a-room-2')
    expect(finished).toEqual([])
    const { run } = tracker.active!
    expect(run.floors[0]).toMatchObject({ rooms: 3, ms: 40_000 })
    expect(run.transitMs).toBe(10_000)
    // Loot is collected on the way out, and a fresh baseline is taken on the way back in.
    expect(boundaries.map((boundary) => boundary.kind)).toEqual(['baseline', 'collect', 'baseline'])
  })

  it('does not count re-entering the same room twice', () => {
    const { tracker } = track()
    floorOne(tracker, 1)
    enter(tracker, '10:00:20', 'SanctumCellar', 'run-a-room-0')
    expect(tracker.active!.run.floors[0].rooms).toBe(1)
  })

  it('only takes the final boss dying on the last floor as a win', () => {
    const { tracker, finished } = track()
    floorOne(tracker, 1)
    tracker.dialogue(at('10:00:15'), 'Lycia, Herald of the Scourge', '*laughter*')
    tracker.dialogue(at('10:00:16'), 'Lycia, Unholy Heretic', 'Beidat, take my flesh!')
    enter(tracker, '10:00:30', 'SanctumFoyer_Fellshrine')
    expect(finished).toEqual([])
    expect(tracker.active!.where).toEqual({ kind: 'lobby' })
  })

  it('can be told that the run failed', () => {
    const { tracker, finished, boundaries } = track()
    floorOne(tracker, 2)
    tracker.fail(at('10:00:50'))
    expect(finished[0]).toMatchObject({ outcome: 'failed', endedAt: at('10:00:50') })
    expect(finished[0].floors[0].ms).toBe(50_000)
    expect(boundaries[boundaries.length - 1]).toMatchObject({ kind: 'collect', floor: 1 })
    expect(tracker.active).toBeNull()
  })

  it('reports where the clock is running for live timers', () => {
    const { tracker } = track()
    floorOne(tracker, 2)
    expect(tracker.active).toMatchObject({ where: { kind: 'floor', floor: 1 }, since: at('10:00:20') })
  })
})
