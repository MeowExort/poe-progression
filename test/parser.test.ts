import { describe, expect, it } from 'vitest'
import { parseLine } from '../src/main/log/parser'

const P = '2026/11/22 18:04:11 123456789 cff945b9'
const info = (message: string): string => `${P} [INFO Client 12345] ${message}`
const debug = (message: string): string => `${P} [DEBUG Client 12345] ${message}`

function eventOf(line: string) {
  const result = parseLine(line)
  if (result.kind !== 'event') throw new Error(`not an event: ${line}`)
  return result.event
}

describe('parseLine', () => {
  it('reads the timestamp as local time', () => {
    const e = eventOf(info(': You have entered The Coast.'))
    expect(e.ts).toBe(new Date(2026, 10, 22, 18, 4, 11).getTime())
  })

  it('parses area generation at any log level', () => {
    expect(eventOf(debug('Generating level 2 area "1_1_2" with seed 3158137559'))).toMatchObject({
      type: 'area_generated',
      level: 2,
      areaId: '1_1_2',
      seed: '3158137559'
    })
    expect(eventOf(info('Generating level 83 area "MapWorldsStrand" with seed 1'))).toMatchObject({
      type: 'area_generated',
      level: 83,
      areaId: 'MapWorldsStrand'
    })
  })

  it('parses entering an area, keeping apostrophes and dots in the name', () => {
    expect(eventOf(info(": You have entered Lioneye's Watch."))).toMatchObject({
      type: 'area_entered',
      name: "Lioneye's Watch"
    })
  })

  it('parses level ups', () => {
    expect(eventOf(info(': Some_Exile (Witch) is now level 12'))).toMatchObject({
      type: 'level_up',
      character: 'Some_Exile',
      class: 'Witch',
      level: 12
    })
  })

  it('parses deaths', () => {
    expect(eventOf(info(': Some_Exile has been slain.'))).toMatchObject({ type: 'death', character: 'Some_Exile' })
  })

  it('parses AFK mode', () => {
    expect(eventOf(info(': AFK mode is now ON. Autoreply "This player is AFK."'))).toMatchObject({ type: 'afk', on: true })
    expect(eventOf(info(': AFK mode is now OFF.'))).toMatchObject({ type: 'afk', on: false })
  })

  it('keeps unmatched system messages for the "unknown" list', () => {
    expect(eventOf(info(': 3 Items identified'))).toMatchObject({ type: 'system', text: '3 Items identified' })
  })

  it('parses NPC and boss lines, including speakers with commas', () => {
    expect(eventOf(info('Sirus, Awakener of Worlds: Die.'))).toMatchObject({
      type: 'dialogue',
      speaker: 'Sirus, Awakener of Worlds',
      text: 'Die.'
    })
  })

  it.each([
    ['global chat', info('#SomePlayer: selling stuff')],
    ['trade chat', info('$SomePlayer: wts')],
    ['party chat', info('%SomePlayer: hi')],
    ['guild chat', info('&<TAG> SomePlayer: hi')],
    ['incoming whisper', info('@From SomePlayer: hi')],
    ['outgoing whisper', info('@To SomePlayer: hi')],
    ['engine debug output', debug('Got Instance Details from login server')],
    ['a line without the standard prefix', 'some continuation of a multi-line message'],
    ['an empty line', '']
  ])('ignores %s', (_name, line) => {
    expect(parseLine(line)).toEqual({ kind: 'ignored' })
  })
})
