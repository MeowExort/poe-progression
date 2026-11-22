import { describe, expect, it } from 'vitest'
import type { Fragment, RouteOptions, RouteStep } from '../src/shared/plan'
import { buildRoute } from '../src/core/route/build'
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
    expect(text(route[0].parts)).toBe('Find and kill [Hillock]')
    expect(text(route[1].parts)).toBe("➞ [Lioneye's Watch]")
    expect(route[1].arrivesAt).toBe('1_1_town')
    expect(text(route[2].parts)).toBe('Hand in [Enemy at the Gate]')
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
      'Little streams connect the 3 Rhoa nests',
      'Usually form a triangle, but will rarely form a line'
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
    expect(lines('kill')).toContain("Kill [Alira Darktongue], take [Alira's Amulet]")
    expect(lines('alira')).toContain('Help [Alira Darktongue], take [The Apex]')
    expect(lines('alira')).not.toContain("Kill [Alira Darktongue], take [Alira's Amulet]")
    expect(lines('oak')).toContain('Find and help [Oak, Skullbreaker], take [The Apex]')
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
    expect(group.map((step) => text(step.parts))).toEqual(['Find 3x[Glyph]', '➞ [The Submerged Passage]'])
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
