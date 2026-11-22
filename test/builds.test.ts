import { describe, expect, it } from 'vitest'
import { BUILDS, rankBuilds } from '../src/core/builds'
import { CHARACTER_CLASSES, STYLES, type Answers } from '../src/shared/plan'

const answers: Answers = { liked: [], avoided: [], priority: 'balance', buttons: 'any', farmUniques: false }

describe('build cards', () => {
  it('have unique ids, known classes and styles, and https guide links', () => {
    expect(new Set(BUILDS.map((build) => build.id)).size).toBe(BUILDS.length)
    for (const build of BUILDS) {
      expect(CHARACTER_CLASSES).toContain(build.class)
      expect(build.styles.length).toBeGreaterThan(0)
      for (const style of build.styles) expect(STYLES).toContain(style)
      for (const value of Object.values(build.traits)) expect([1, 2, 3]).toContain(value)
      expect(build.guide.url).toMatch(/^https:\/\//)
      if (build.needsUniques) expect(build.uniquesNote).toBeTruthy()
    }
  })

  it('cover every play style', () => {
    for (const style of STYLES) expect(BUILDS.some((build) => build.styles.includes(style))).toBe(true)
  })
})

describe('rankBuilds', () => {
  it('puts builds of a liked style first', () => {
    const ranked = rankBuilds({ ...answers, liked: ['bow'] })
    const bowCount = BUILDS.filter((build) => build.styles.includes('bow')).length
    expect(ranked.slice(0, bowCount).every((entry) => entry.build.styles.includes('bow'))).toBe(true)
  })

  it('moves avoided styles to the end and marks them', () => {
    const ranked = rankBuilds({ ...answers, avoided: ['minion'] })
    const firstExcluded = ranked.findIndex((entry) => entry.excluded)
    expect(firstExcluded).toBeGreaterThan(0)
    expect(ranked.slice(firstExcluded).every((entry) => entry.build.styles.includes('minion'))).toBe(true)
    expect(ranked.slice(0, firstExcluded).some((entry) => entry.build.styles.includes('minion'))).toBe(false)
  })

  it('penalises builds that need a unique unless the player agrees to farm it', () => {
    const position = (farmUniques: boolean): number =>
      rankBuilds({ ...answers, liked: ['melee'], farmUniques }).findIndex(
        (entry) => entry.build.id === 'facebreaker-luminary'
      )
    expect(position(false)).toBeGreaterThan(position(true))
  })

  it('follows the stated priority', () => {
    const top = rankBuilds({ ...answers, priority: 'tank' })[0]
    expect(top.build.traits.tank).toBe(3)
  })
})
