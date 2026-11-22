import { describe, expect, it } from 'vitest'
import type { FeedEntry, LogEvent } from '../src/shared/events'
import { Session } from '../src/main/session'

const generated = (ts: number, areaId: string, level: number): LogEvent => ({
  type: 'area_generated',
  ts,
  areaId,
  level,
  seed: '42'
})
const entered = (ts: number, name: string): LogEvent => ({ type: 'area_entered', ts, name })

describe('Session', () => {
  it('joins area generation with the following "entered" line', () => {
    const session = new Session()
    session.apply([generated(1000, '1_1_2', 2), entered(1500, 'The Coast')], true)
    expect(session.getState().area).toEqual({
      name: 'The Coast',
      areaId: '1_1_2',
      level: 2,
      seed: '42',
      enteredAt: 1500
    })
    expect(session.getState().feed).toMatchObject([{ type: 'area_entered', name: 'The Coast', level: 2, areaId: '1_1_2' }])
  })

  it('does not reuse a stale generation line for a later area', () => {
    const session = new Session()
    session.apply([generated(1000, '1_1_2', 2), entered(1500, 'The Coast'), entered(2000, "Lioneye's Watch")], true)
    expect(session.getState().area).toMatchObject({ name: "Lioneye's Watch", areaId: null, level: null })
  })

  it('counts deaths and areas, tracks the character', () => {
    const session = new Session()
    session.apply(
      [
        entered(1, 'The Coast'),
        { type: 'level_up', ts: 2, character: 'Exile', class: 'Witch', level: 3 },
        { type: 'death', ts: 3, character: 'Exile' },
        entered(4, "Lioneye's Watch")
      ],
      true
    )
    const state = session.getState()
    expect(state.character).toEqual({ name: 'Exile', class: 'Witch', level: 3 })
    expect(state.deaths).toBe(1)
    expect(state.areasEntered).toBe(2)
  })

  it('restores state from backfill without counting or recording it', () => {
    const recorded: FeedEntry[] = []
    const session = new Session({ onRecord: (entry) => recorded.push(entry) })
    session.apply(
      [
        generated(1, '1_1_2', 2),
        entered(2, 'The Coast'),
        { type: 'level_up', ts: 3, character: 'Exile', class: 'Witch', level: 3 },
        { type: 'death', ts: 4, character: 'Exile' }
      ],
      false
    )
    const state = session.getState()
    expect(state.area?.name).toBe('The Coast')
    expect(state.character?.level).toBe(3)
    expect(state.deaths).toBe(0)
    expect(state.areasEntered).toBe(0)
    expect(state.feed).toEqual([])
    expect(recorded).toEqual([])
  })

  it('records area, level and death events but not dialogue or system lines', () => {
    const recorded: FeedEntry[] = []
    const session = new Session({ onRecord: (entry) => recorded.push(entry) })
    session.apply(
      [
        entered(1, 'The Coast'),
        { type: 'dialogue', ts: 2, speaker: 'Nessa', text: 'Hello.' },
        { type: 'system', ts: 3, text: 'Something new' },
        { type: 'death', ts: 4, character: 'Exile' }
      ],
      true
    )
    expect(recorded.map((entry) => entry.type)).toEqual(['area_entered', 'death'])
    expect(session.getState().unknown).toMatchObject([{ type: 'system', text: 'Something new' }])
  })
})
