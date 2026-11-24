import { describe, expect, it } from 'vitest'
import { SiteWatch } from '../src/main/site-watch'

describe('SiteWatch', () => {
  const GAP = 60_000

  it('does not read while nothing changed', () => {
    const watch = new SiteWatch(GAP)
    expect(watch.areaChanged(false, 0)).toBe(false)
    expect(watch.areaChanged(false, 100_000)).toBe(false)
  })

  it('reads on the area change after a level-up, not on the level-up itself', () => {
    const watch = new SiteWatch(GAP)
    watch.areaChanged(false, 0)
    watch.levelUp()
    // Still in the same area: the site has not heard of the level yet.
    expect(watch.areaChanged(false, 5000)).toBe(true)
    watch.read(5000)
    expect(watch.areaChanged(false, 200_000)).toBe(false)
  })

  it('reads on leaving a town, where points are spent, rather than on entering it', () => {
    const watch = new SiteWatch(GAP)
    expect(watch.areaChanged(true, 0)).toBe(false)
    expect(watch.areaChanged(false, 30_000)).toBe(true)
    watch.read(30_000)
    // Town to town counts as leaving one too.
    expect(watch.areaChanged(true, 200_000)).toBe(false)
    expect(watch.areaChanged(true, 300_000)).toBe(true)
  })

  it('waits out the gap, then reads on the next area change', () => {
    const watch = new SiteWatch(GAP)
    watch.read(0)
    watch.levelUp()
    expect(watch.areaChanged(false, 10_000)).toBe(false)
    expect(watch.areaChanged(false, 59_000)).toBe(false)
    expect(watch.areaChanged(false, 61_000)).toBe(true)
  })
})
