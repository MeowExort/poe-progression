/**
 * Decides when the character is worth reading from pathofexile.com again.
 *
 * The site only learns what changed in the game when the character moves to another area.
 * So a level-up, or a stay in a town (where points are spent and gems swapped), makes the
 * site's copy stale — and the next area change is the first moment a reading can see it.
 */
export class SiteWatch {
  private stale = false
  private inTown = false
  private lastReadAt = Number.NEGATIVE_INFINITY

  constructor(private readonly minGapMs: number) {}

  /** The character gained a level: there is a passive point to spend. */
  levelUp(): void {
    this.stale = true
  }

  /**
   * The character entered an area. Returns true when the site should be read now: something
   * changed since the last reading, and the last reading was not a moment ago.
   */
  areaChanged(isTown: boolean, now: number): boolean {
    // Whatever was done in the town just left is on the site from this moment.
    if (this.inTown) this.stale = true
    this.inTown = isTown
    return this.stale && now - this.lastReadAt >= this.minGapMs
  }

  /** A reading was made: what the site has now is what the app knows. */
  read(now: number): void {
    this.stale = false
    this.lastReadAt = now
  }
}
