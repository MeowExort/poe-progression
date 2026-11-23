import { describe, expect, it } from 'vitest'
import type { Fragment, RouteOptions, RouteStep } from '../src/shared/plan'
import { buildRoute } from '../src/core/route/build'
import { ROUTE_SOURCES } from '../src/core/route/data'
import { ROUTE_RU, routeLineKey, translateParts } from '../src/core/route/ru'
import { currentGroup, groupEnd, previousGroupStart } from '../src/core/route/groups'
import { advance } from '../src/core/route/tracker'

const options: RouteOptions = { bandit: 'kill', leagueStart: true, library: false }

function text(parts: Fragment[]): string {
  return parts
    .map((part) => {
      switch (part.type) {
        case 'text':
          return part.text
        case 'enter':
        case 'waypoint_use':
        case 'logout':
        case 'portal_use':
        case 'area':
        case 'arena':
        case 'kill':
        case 'quest':
          return `[${part.name}]`
        case 'quest_text':
        case 'generic':
          return `[${part.text}]`
        default:
          return `[${part.type}]`
      }
    })
    .join('')
}

const route = buildRoute(options)
const find = (predicate: (step: RouteStep) => boolean): RouteStep => {
  const step = route.find(predicate)
  if (!step) throw new Error('step not found')
  return step
}

describe('buildRoute', () => {
  it('starts on the Twilight Strand and resolves names', () => {
    expect(route[0]).toMatchObject({ act: 1, areaId: '1_1_1', areaName: 'The Twilight Strand', arrivesAt: null })
    expect(text(route[0].parts)).toBe('Найди и убей [Hillock]')
    expect(text(route[1].parts)).toBe("➞ [Lioneye's Watch]")
    expect(route[1].arrivesAt).toBe('1_1_town')
    expect(text(route[2].parts)).toBe('Сдай квест [Enemy at the Gate]')
  })

  it('covers all ten acts and ends in Karui Shores territory', () => {
    expect(new Set(route.map((step) => step.act))).toEqual(new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]))
    expect(route.length).toBeGreaterThan(400)
  })

  it('leaves no unresolved fragments or comments in the text', () => {
    for (const step of route) {
      for (const parts of [step.parts, ...step.subSteps]) {
        const rendered = text(parts)
        expect(rendered).not.toMatch(/[{}#]/)
      }
    }
  })

  it('attaches hints to the step above them', () => {
    const glyphs = find((step) => text(step.parts).includes('[Glyph]'))
    expect(glyphs.subSteps.map(text)).toEqual([
      'Три гнезда Rhoa соединены ручейками',
      'Обычно они стоят треугольником, изредка — в линию'
    ])
  })

  it('sends a logout to the last visited town', () => {
    const logout = find((step) => step.parts.some((part) => part.type === 'logout'))
    expect(logout.areaId).toBe('1_1_2a')
    expect(logout.arrivesAt).toBe('1_1_town')
  })

  it('includes league-start steps only when asked', () => {
    const withStart = route.some((step) => step.parts.some((part) => part.type === 'enter' && part.areaId === '1_1_2a'))
    const without = buildRoute({ ...options, leagueStart: false }).some((step) =>
      step.parts.some((part) => part.type === 'enter' && part.areaId === '1_1_2a')
    )
    expect(withStart).toBe(true)
    expect(without).toBe(false)
  })

  it('picks the bandit branch', () => {
    const lines = (bandit: RouteOptions['bandit']): string[] =>
      buildRoute({ ...options, bandit }).map((step) => text(step.parts))
    expect(lines('kill')).toContain("Убей [Alira Darktongue], забери [Alira's Amulet]")
    expect(lines('alira')).toContain('Помоги [Alira Darktongue], забери [The Apex]')
    expect(lines('alira')).not.toContain("Убей [Alira Darktongue], забери [Alira's Amulet]")
    expect(lines('oak')).toContain('Найди [Oak, Skullbreaker] и помоги, забери [The Apex]')
  })

  it('keeps the walk consistent: every step starts where the previous one ended', () => {
    let area = '1_1_1'
    for (const step of route) {
      expect(step.areaId).toBe(area)
      if (step.arrivesAt) area = step.arrivesAt
    }
  })

  it('adds the Library detour only when asked', () => {
    const visitsLibrary = (library: boolean): boolean =>
      buildRoute({ ...options, library }).some((step) => step.arrivesAt === '1_3_17_1')
    expect(visitsLibrary(true)).toBe(true)
    expect(visitsLibrary(false)).toBe(false)
  })
})

describe('Russian wording', () => {
  const lines = ROUTE_SOURCES.flatMap((source) => source.split(/\r\n|\r|\n/))
    .map((line) => line.trim())
    .filter((line) => line && !/^#(section|ifdef|ifndef|endif)/.test(line))
    .map((line) => (line.startsWith('#sub') ? { hint: true, line: line.slice(4).trim() } : { hint: false, line }))

  it('has every line of the route, in every branch', () => {
    const missing = [...new Set(lines.map(({ line, hint }) => routeLineKey(line, hint)))].filter((key) => !(key in ROUTE_RU))
    expect(missing).toEqual([])
  })

  it('uses every fragment of a line exactly once', () => {
    for (const [key, template] of Object.entries(ROUTE_RU)) {
      const fragments = key.match(/\{\w+\}/g)?.length ?? 0
      const slots = (template.match(/\{\d+\}/g) ?? []).map((slot) => +slot.slice(1, -1)).sort((a, b) => a - b)
      expect(slots, key).toEqual(Array.from({ length: fragments }, (_, i) => i))
    }
  })

  it('carries no dead entries', () => {
    const used = new Set(lines.map(({ line, hint }) => routeLineKey(line, hint)))
    expect(Object.keys(ROUTE_RU).filter((key) => !used.has(key))).toEqual([])
  })

  it('leaves game names in English and words the rest in Russian', () => {
    for (const step of route) {
      for (const parts of [step.parts, ...step.subSteps]) {
        for (const part of parts) {
          // Names of the game world may stand in the middle of a sentence.
          if (part.type === 'text') expect(part.text.replace(/Rhoa|Karui|Wraeclast|Oriath/g, ''), text(parts)).not.toMatch(/[A-Za-z]{2,}/)
        }
      }
    }
    expect(route.flatMap((step) => step.subSteps.map(text))).toContain('Иди [dir]')
  })

  it('may put the fragments in another order than the English line', () => {
    const parts: Fragment[] = [
      { type: 'text', text: 'Find and help ' },
      { type: 'kill', name: 'Oak' },
      { type: 'text', text: ', take ' },
      { type: 'quest_text', text: 'The Apex' }
    ]
    expect(text(translateParts('Find and help {kill|Oak}, take {quest_text|The Apex}', false, parts))).toBe(
      'Найди [Oak] и помоги, забери [The Apex]'
    )
    // A line the dictionary does not know stays as it was.
    expect(translateParts('Dance with {kill|Oak}', false, parts)).toBe(parts)
  })
})

describe('tracker', () => {
  const indexOfArrival = (areaId: string, from = 0): number =>
    route.findIndex((step, i) => i >= from && step.arrivesAt === areaId)

  it('advances when the player enters the next area of the route', () => {
    expect(advance(route, 0, '1_1_town')).toBe(indexOfArrival('1_1_town') + 1)
  })

  it('ignores areas the route does not go to next', () => {
    expect(advance(route, 0, '1_3_town')).toBe(0)
  })

  it('ignores re-entering the current area', () => {
    const inCoast = indexOfArrival('1_1_2') + 1
    expect(advance(route, inCoast, '1_1_2')).toBe(inCoast)
  })

  it('lets the player skip one planned area change, but not into a town', () => {
    // In town after Hillock: the route goes Coast, then Mud Flats.
    const inTown = indexOfArrival('1_1_town') + 1
    expect(advance(route, inTown, '1_1_3')).toBe(indexOfArrival('1_1_3') + 1)

    // In the Mud Flats a portal trip to town must not skip the Submerged Passage.
    const inMudFlats = indexOfArrival('1_1_3') + 1
    expect(advance(route, inMudFlats, '1_1_town')).toBe(inMudFlats)
  })

  it('groups the steps to do before the next area change', () => {
    const inMudFlats = indexOfArrival('1_1_3') + 1
    const group = currentGroup(route, inMudFlats)
    expect(group.map((step) => text(step.parts))).toEqual(['Найди 3× [Glyph]', '➞ [The Submerged Passage]'])
    expect(groupEnd(route, inMudFlats)).toBe(inMudFlats + 2)
  })

  it('steps back to the start of the previous group', () => {
    const inMudFlats = indexOfArrival('1_1_3') + 1
    const next = groupEnd(route, inMudFlats)
    expect(previousGroupStart(route, next)).toBe(inMudFlats)
    expect(previousGroupStart(route, 0)).toBe(0)
  })

  it('walks the whole campaign by following the arrivals', () => {
    let position = 0
    for (const step of route) {
      if (step.arrivesAt) position = advance(route, position, step.arrivesAt)
    }
    expect(groupEnd(route, position)).toBe(route.length)
  })
})
